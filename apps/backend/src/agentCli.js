import { spawnSync } from "node:child_process";
import { providerConfig, sanitizeAgentProcessEnv } from "./providerAuth.js";
import { buildCodexProfileEnv, recordCodexProfileUsed, selectCodexProfile } from "./codexProfiles.js";

function truthyEnv(value = "") {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function commandAvailable(command) {
  if (!command) return false;
  const result = spawnSync(command, ["--version"], { stdio: "ignore", timeout: 5000 });
  return !result.error && result.status === 0;
}

export function isServerOpenAIRuntime() {
  const target = String(
    process.env.AGENTIC_RUNTIME_TARGET ||
    process.env.AGENT_EXECUTION_TARGET ||
    process.env.BUILDERX_RUNTIME_TARGET ||
    ""
  ).trim().toLowerCase();
  if (["server", "cloud", "droplet", "openai"].includes(target)) return true;
  if (["local", "desktop", "vscode", "cli"].includes(target)) return false;
  if (truthyEnv(process.env.FORCE_OPENAI_AGENT_RUNTIME)) return true;
  if (truthyEnv(process.env.DISABLE_OPENAI_AGENT_RUNTIME)) return false;
  if (process.env.DIGITALOCEAN_APP_ID || process.env.DIGITALOCEAN_DROPLET_ID) return true;
  return process.env.NODE_ENV === "production" && Boolean(process.env.OPENAI_API_KEY);
}

export function resolveAgentCli() {
  const requested = String(process.env.AI_CLI_PROVIDER || "auto").trim().toLowerCase();
  const explicitBin = String(process.env.AI_CLI_BIN || "").trim();

  if (requested === "openai") {
    return { provider: "openai", command: "openai-api" };
  }
  if (requested === "codex") {
    const auth = providerConfig("codex");
    if (!auth.enabled) throw new Error("Codex provider authentication is disabled.");
    return { provider: "codex", command: explicitBin || process.env.CODEX_BIN || "codex" };
  }
  if (requested === "claude") {
    const auth = providerConfig("claude");
    if (!auth.enabled) throw new Error("Claude provider authentication is disabled.");
    return { provider: "claude", command: explicitBin || process.env.CLAUDE_BIN || "claude" };
  }
  if (requested !== "auto") {
    throw new Error(`Unsupported AI_CLI_PROVIDER=${requested}. Use auto, codex, claude, or openai.`);
  }

  if (isServerOpenAIRuntime()) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Server OpenAI runtime was selected but OPENAI_API_KEY is missing.");
    }
    return { provider: "openai", command: "openai-api" };
  }

  // Preserve test/custom binary compatibility and prefer an explicitly configured tool.
  if (process.env.CODEX_BIN && providerConfig("codex").enabled) return { provider: "codex", command: process.env.CODEX_BIN };
  if (process.env.CLAUDE_BIN && providerConfig("claude").enabled) return { provider: "claude", command: process.env.CLAUDE_BIN };
  if (explicitBin) {
    const provider = /claude/i.test(explicitBin) ? "claude" : "codex";
    const auth = providerConfig(provider);
    if (!auth.enabled) throw new Error(`${provider} provider authentication is disabled.`);
    return { provider, command: explicitBin };
  }
  if (providerConfig("codex").enabled && commandAvailable("codex")) return { provider: "codex", command: "codex" };
  if (providerConfig("claude").enabled && commandAvailable("claude")) return { provider: "claude", command: "claude" };
  throw new Error(
    "No supported local agent CLI was found. Install and authenticate Codex or Claude Code, " +
    "set AI_CLI_PROVIDER and AI_CLI_BIN, or set AI_CLI_PROVIDER=openai with OPENAI_API_KEY."
  );
}

export function agentCliInvocation({ prompt, cwd, codexProfileId, codexProfileSelectionMode }) {
  const cli = resolveAgentCli();
  if (cli.provider === "openai") {
    return {
      ...cli,
      args: [],
      prompt,
      cwd
    };
  }
  let codexProfile = null;
  let env = sanitizeAgentProcessEnv(process.env);
  if (cli.provider === "codex") {
    codexProfile = selectCodexProfile({
      requestedProfileId: codexProfileId,
      strategy: codexProfileSelectionMode
    });
    recordCodexProfileUsed(codexProfile.id);
    env = buildCodexProfileEnv(codexProfile, process.env);
  }
  if (cli.provider === "claude") {
    return {
      ...cli,
      args: [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions"
      ],
      cwd,
      env
    };
  }
  return {
    ...cli,
    args: [
      "exec",
      "--json",
      "--cd",
      cwd,
      "--skip-git-repo-check",
      "--ephemeral",
      "--dangerously-bypass-approvals-and-sandbox",
      prompt
    ],
    cwd,
    env,
    codexProfile: codexProfile ? {
      id: codexProfile.id,
      displayName: codexProfile.displayName,
      status: codexProfile.status,
      isDefault: codexProfile.isDefault
    } : null
  };
}

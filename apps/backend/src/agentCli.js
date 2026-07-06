import { spawnSync } from "node:child_process";

function commandAvailable(command) {
  if (!command) return false;
  const result = spawnSync(command, ["--version"], { stdio: "ignore", timeout: 5000 });
  return !result.error && result.status === 0;
}

export function resolveAgentCli() {
  const requested = String(process.env.AI_CLI_PROVIDER || "auto").trim().toLowerCase();
  const explicitBin = String(process.env.AI_CLI_BIN || "").trim();

  if (requested === "codex") {
    return { provider: "codex", command: explicitBin || process.env.CODEX_BIN || "codex" };
  }
  if (requested === "claude") {
    return { provider: "claude", command: explicitBin || process.env.CLAUDE_BIN || "claude" };
  }
  if (requested !== "auto") {
    throw new Error(`Unsupported AI_CLI_PROVIDER=${requested}. Use auto, codex, or claude.`);
  }

  // Preserve test/custom binary compatibility and prefer an explicitly configured tool.
  if (process.env.CODEX_BIN) return { provider: "codex", command: process.env.CODEX_BIN };
  if (process.env.CLAUDE_BIN) return { provider: "claude", command: process.env.CLAUDE_BIN };
  if (explicitBin) {
    const provider = /claude/i.test(explicitBin) ? "claude" : "codex";
    return { provider, command: explicitBin };
  }
  if (commandAvailable("codex")) return { provider: "codex", command: "codex" };
  if (commandAvailable("claude")) return { provider: "claude", command: "claude" };
  throw new Error(
    "No supported agent CLI was found. Install and authenticate Codex or Claude Code, " +
    "or set AI_CLI_PROVIDER and AI_CLI_BIN."
  );
}

export function agentCliInvocation({ prompt, cwd }) {
  const cli = resolveAgentCli();
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
      cwd
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
    cwd
  };
}


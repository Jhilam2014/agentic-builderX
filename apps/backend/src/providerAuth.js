import { spawnSync } from "node:child_process";

const PROVIDERS = ["codex", "claude"];
const AUTH_MODES = ["api_key", "existing_cli_session", "disabled"];
const PLACEHOLDER_PATTERN = /^(|\.{3}|changeme|change_me|your_key_here|your-value|replace-me)$/i;

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function isPlaceholder(value = "") {
  return PLACEHOLDER_PATTERN.test(String(value || "").trim());
}

function truthy(value = "") {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function commandAvailable(command) {
  if (!command) return false;
  const result = spawnSync(command, ["--version"], { stdio: "ignore", timeout: 5000 });
  return !result.error && result.status === 0;
}

function providerLabel(provider) {
  return provider === "codex" ? "Codex GPT" : "Claude";
}

function apiKeyName(provider) {
  return provider === "codex" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
}

function cliCommand(provider) {
  if (provider === "codex") return env("CODEX_BIN") || (env("AI_CLI_PROVIDER").toLowerCase() === "codex" ? env("AI_CLI_BIN") : "") || "codex";
  return env("CLAUDE_BIN") || (env("AI_CLI_PROVIDER").toLowerCase() === "claude" ? env("AI_CLI_BIN") : "") || "claude";
}

function runtimeDefaultAuthMode() {
  const target = env("AGENTIC_RUNTIME_TARGET") || env("AGENT_EXECUTION_TARGET") || env("BUILDERX_RUNTIME_TARGET") || "local";
  return /^(local|desktop|vscode|cli)$/i.test(target) ? "existing_cli_session" : "api_key";
}

function authMode(provider) {
  const explicit = env(provider === "codex" ? "CODEX_AUTH_MODE" : "CLAUDE_AUTH_MODE");
  const raw = (explicit || runtimeDefaultAuthMode()).toLowerCase();
  return AUTH_MODES.includes(raw) ? raw : "disabled";
}

function secretConfigured(name) {
  const value = env(name);
  return Boolean(value && !isPlaceholder(value));
}

export function providerConfig(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error("Unsupported provider.");
  const mode = authMode(provider);
  const enabled = mode !== "disabled";
  const diagnostics = [];
  let configured = false;
  let connected = false;

  if (mode === "disabled") {
    configured = true;
  } else if (mode === "api_key") {
    configured = secretConfigured(apiKeyName(provider));
    connected = configured;
    if (!configured) diagnostics.push(`${apiKeyName(provider)} is not configured.`);
  } else if (mode === "existing_cli_session") {
    const isolated = truthy(process.env.EXISTING_CLI_SESSION_ISOLATED) || process.env.NODE_ENV !== "production";
    configured = isolated && commandAvailable(cliCommand(provider));
    connected = configured;
    if (!isolated) diagnostics.push("Existing CLI session mode requires an isolated per-user runtime.");
    if (isolated && !configured) diagnostics.push(`${cliCommand(provider)} is not available.`);
  }

  return {
    provider,
    label: providerLabel(provider),
    enabled,
    authMode: mode,
    configured,
    connected,
    connectUrl: "",
    diagnostics
  };
}

export function listProviderConfigs() {
  return Object.fromEntries(PROVIDERS.map((provider) => [provider, providerConfig(provider)]));
}

export function sanitizeAgentProcessEnv(sourceEnv = process.env) {
  return Object.fromEntries(Object.entries(sourceEnv).filter(([key]) => {
    if (/(^|_)SSO(_|$)/.test(key)) return false;
    if (/^AUTH_.*SECRET$/.test(key)) return false;
    if (/^AUTH_.*ENCRYPTION_KEY$/.test(key)) return false;
    if (/^PROVIDER_.*CREDENTIAL/.test(key)) return false;
    return true;
  }));
}

export function authConfigurationDiagnostics() {
  return PROVIDERS.map((provider) => providerConfig(provider));
}

export const providerAuthTestHooks = {
  providerConfig,
  isPlaceholder,
  authMode
};

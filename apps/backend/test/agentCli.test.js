import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { agentCliInvocation, resolveAgentCli } from "../src/agentCli.js";
import { writeCodexProfileRegistry } from "../src/codexProfiles.js";

function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("builds a Claude Code non-interactive streaming invocation", () => {
  withEnv({ AI_CLI_PROVIDER: "claude", AI_CLI_BIN: "/tools/claude", CODEX_BIN: undefined, CLAUDE_BIN: undefined }, () => {
    const invocation = agentCliInvocation({ prompt: "Build the app", cwd: "/workspace/app" });
    assert.equal(invocation.provider, "claude");
    assert.equal(invocation.command, "/tools/claude");
    assert.equal(invocation.cwd, "/workspace/app");
    assert.deepEqual(invocation.args.slice(0, 2), ["-p", "Build the app"]);
    assert.ok(invocation.args.includes("stream-json"));
    assert.ok(invocation.args.includes("--dangerously-skip-permissions"));
  });
});

test("preserves Codex CLI argument compatibility", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "builderx-agent-cli-profile-"));
  withEnv({
    AI_CLI_PROVIDER: "codex",
    AI_CLI_BIN: "/tools/codex",
    CODEX_BIN: undefined,
    CLAUDE_BIN: undefined,
    CODEX_PROFILES_ROOT: root,
    CODEX_PROFILE_REGISTRY_PATH: path.join(root, "registry.json")
  }, () => {
    writeCodexProfileRegistry([{ id: "task-A", relativeDirectory: "task-A", enabled: true, status: "connected" }]);
    const invocation = agentCliInvocation({ prompt: "Build the app", cwd: "/workspace/app", codexProfileId: "task-A" });
    assert.equal(invocation.provider, "codex");
    assert.equal(invocation.command, "/tools/codex");
    assert.deepEqual(invocation.args.slice(0, 4), ["exec", "--json", "--cd", "/workspace/app"]);
    assert.equal(invocation.args.at(-1), "Build the app");
    assert.equal(invocation.env.CODEX_HOME, path.join(root, "task-A"));
  });
});

test("supports OpenAI API provider without spawning a local CLI", () => {
  withEnv({ AI_CLI_PROVIDER: "openai", AI_CLI_BIN: "", CODEX_BIN: undefined, CLAUDE_BIN: undefined }, () => {
    const invocation = agentCliInvocation({ prompt: "Build the app", cwd: "/workspace/app" });
    assert.equal(invocation.provider, "openai");
    assert.equal(invocation.command, "openai-api");
    assert.deepEqual(invocation.args, []);
    assert.equal(invocation.prompt, "Build the app");
  });
});

test("auto selects OpenAI on server runtime target when configured", () => {
  withEnv({
    AI_CLI_PROVIDER: "auto",
    AI_CLI_BIN: "",
    CODEX_BIN: undefined,
    CLAUDE_BIN: undefined,
    AGENTIC_RUNTIME_TARGET: "droplet",
    OPENAI_API_KEY: "test-key"
  }, () => {
    const invocation = agentCliInvocation({ prompt: "Build the app", cwd: "/workspace/app" });
    assert.equal(invocation.provider, "openai");
  });
});

test("rejects unknown providers", () => {
  withEnv({ AI_CLI_PROVIDER: "unknown", AI_CLI_BIN: "", CODEX_BIN: undefined, CLAUDE_BIN: undefined }, () => {
    assert.throws(() => resolveAgentCli(), /Unsupported AI_CLI_PROVIDER/);
  });
});

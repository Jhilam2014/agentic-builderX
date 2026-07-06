import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import fs from "fs-extra";
import { runProjectOrchestratorBootstrap } from "../src/projectBootstrap.js";

test("uses the native Claude new-project setup command", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "builderx-claude-new-project-"));
  const workspaceDir = path.join(root, "project");
  const fakeClaude = path.join(root, "fake-claude");
  const previous = {
    AI_CLI_PROVIDER: process.env.AI_CLI_PROVIDER,
    AI_CLI_BIN: process.env.AI_CLI_BIN,
    ORCHESTRATOR_BOOTSTRAP_ENABLED: process.env.ORCHESTRATOR_BOOTSTRAP_ENABLED
  };
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.remove(root);
  });

  await fs.ensureDir(path.join(workspaceDir, ".claude", "commands"));
  await fs.writeFile(path.join(workspaceDir, ".claude", "commands", "setup-new-project.md"), "new setup\n");
  await fs.writeFile(fakeClaude, "#!/bin/sh\nprintf '%s\\n' \"$@\" > claude-args.txt\n");
  await fs.chmod(fakeClaude, 0o755);
  process.env.AI_CLI_PROVIDER = "claude";
  process.env.AI_CLI_BIN = fakeClaude;
  process.env.ORCHESTRATOR_BOOTSTRAP_ENABLED = "true";

  const result = await runProjectOrchestratorBootstrap(
    { id: "new-project", name: "New Project", workspaceDir },
    { setupMode: "new" }
  );
  const args = await fs.readFile(path.join(workspaceDir, "claude-args.txt"), "utf8");

  assert.equal(result.cliProvider, "claude");
  assert.equal(result.setupMode, "new");
  assert.equal(result.promptPath, ".claude/commands/setup-new-project.md");
  assert.match(args, /\/setup-new-project/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import {
  buildCodexProfileEnv,
  cleanupCodexProfileLoginSessions,
  codexProfileTestHooks,
  createCodexProfile,
  deleteCodexProfile,
  enableCodexProfile,
  getCodexProfileLoginSession,
  listCodexProfiles,
  markCodexProfileUnavailable,
  openCodexProfileLogin,
  refreshCodexProfileUsage,
  selectCodexProfile,
  setDefaultCodexProfile,
  validateCodexProfile,
  writeCodexProfileRegistry
} from "../src/codexProfiles.js";

afterEach(() => {
  cleanupCodexProfileLoginSessions();
});

function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withEnvAsync(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function tempProfileEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "builderx-dynamic-codex-"));
  const registry = path.join(root, "registry.json");
  return {
    root,
    registry,
    env: {
      CODEX_PROFILES_ROOT: root,
      CODEX_PROFILE_REGISTRY_PATH: registry,
      CODEX_DEFAULT_PROFILE_ID: undefined,
      CODEX_PROFILE_FALLBACK_ORDER: undefined
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(callback, { timeoutMs = 3000, intervalMs = 25 } = {}) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    lastValue = await callback();
    if (lastValue) return lastValue;
    await sleep(intervalMs);
  }
  return lastValue;
}

test("creates a dynamic profile from alias metadata only", () => {
  const fixture = tempProfileEnv();
  withEnv(fixture.env, () => {
    const result = createCodexProfile({ id: "jhilam-main", displayName: "Main Codex account" });
    assert.equal(result.profile.id, "jhilam-main");
    assert.equal(result.profile.relativeDirectory, "jhilam-main");
    assert.equal(result.profile.status, "disconnected");
    assert.match(result.login.command, /CODEX_HOME=/);
    assert.ok(fs.existsSync(path.join(fixture.root, "jhilam-main")));
    const raw = fs.readFileSync(fixture.registry, "utf8");
    assert.doesNotMatch(raw, /auth\.json|access_token|refresh_token/i);
    assert.doesNotMatch(raw, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("validates profile IDs and rejects path-like or credential-like input", () => {
  for (const id of ["jhilam-main", "codex2", "team_alpha", "account.03", "profile-8392"]) {
    assert.equal(codexProfileTestHooks.validateCodexProfileId(id), id);
  }
  for (const id of ["../profile", "/Users/name/.codex", "profile/account", "profile account", "file:///tmp/test", "$(whoami)", "a..b"]) {
    assert.throws(() => codexProfileTestHooks.validateCodexProfileId(id));
  }
});

test("selects requested, configured default, and dynamic fallback profiles", () => {
  const fixture = tempProfileEnv();
  withEnv({ ...fixture.env, CODEX_ALLOW_AUTOMATIC_PROFILE_FALLBACK: "true", CODEX_PROFILE_FALLBACK_ORDER: "account-02,account-03" }, () => {
    writeCodexProfileRegistry([
      { id: "jhilam-main", displayName: "Main", relativeDirectory: "jhilam-main", enabled: true, isDefault: false, priority: 1, status: "connected" },
      { id: "account-02", displayName: "Second", relativeDirectory: "account-02", enabled: true, isDefault: false, priority: 2, status: "connected" },
      { id: "account-03", displayName: "Third", relativeDirectory: "account-03", enabled: true, isDefault: false, priority: 3, status: "connected" }
    ]);
    assert.equal(selectCodexProfile({ requestedProfileId: "account-02" }).id, "account-02");
    process.env.CODEX_DEFAULT_PROFILE_ID = "jhilam-main";
    assert.equal(selectCodexProfile({}).id, "jhilam-main");
    delete process.env.CODEX_DEFAULT_PROFILE_ID;
    markCodexProfileUnavailable("jhilam-main", "usage_limit");
    assert.equal(selectCodexProfile({ strategy: "fallback_on_limit" }).id, "account-02");
    setDefaultCodexProfile("account-03");
    assert.equal(listCodexProfiles().find((profile) => profile.isDefault).id, "account-03");
  });
});

test("requires explicit selection when multiple connected profiles exist", () => {
  const fixture = tempProfileEnv();
  withEnv(fixture.env, () => {
    writeCodexProfileRegistry([
      { id: "alpha", relativeDirectory: "alpha", enabled: true, status: "connected" },
      { id: "beta", relativeDirectory: "beta", enabled: true, status: "connected" }
    ]);
    assert.throws(() => selectCodexProfile({}), /Select a Codex profile/);
  });
});

test("deletes metadata only and retains the profile directory", () => {
  const fixture = tempProfileEnv();
  withEnv(fixture.env, () => {
    createCodexProfile({ id: "account-02" });
    const profileDir = path.join(fixture.root, "account-02");
    const result = deleteCodexProfile("account-02");
    assert.match(result.message, /directory was retained/);
    assert.ok(fs.existsSync(profileDir));
    assert.equal(listCodexProfiles().some((profile) => profile.id === "account-02"), false);
  });
});

test("builds isolated per-child Codex env and strips SSO-only configuration", () => {
  const fixture = tempProfileEnv();
  withEnv(fixture.env, () => {
    const profileA = createCodexProfile({ id: "task-A" }).profile;
    const profileB = createCodexProfile({ id: "task-B" }).profile;
    const envA = buildCodexProfileEnv(profileA, { PATH: process.env.PATH, LEGACY_SSO_ENDPOINT: "x" });
    const envB = buildCodexProfileEnv(profileB, { PATH: process.env.PATH, AUTH_PROVIDER_SECRET: "x" });
    assert.equal(envA.CODEX_HOME, path.join(fixture.root, "task-A"));
    assert.equal(envB.CODEX_HOME, path.join(fixture.root, "task-B"));
    assert.equal(envA.LEGACY_SSO_ENDPOINT, undefined);
    assert.equal(envB.AUTH_PROVIDER_SECRET, undefined);
  });
});

test("validates a profile by spawning codex login status with CODEX_HOME", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex.sh");
  fs.writeFileSync(mockBin, "#!/usr/bin/env bash\n[ \"$1 $2\" = \"login status\" ] || exit 3\n[ -n \"$CODEX_HOME\" ] || exit 4\nexit 0\n");
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "solo" });
    const result = await validateCodexProfile("solo", { timeoutMs: 3000 });
    assert.equal(result.status, "connected");
    assert.equal(listCodexProfiles().find((profile) => profile.id === "solo").status, "connected");
  });
});

test("extracts a standard browser OAuth URL and keeps the login child alive", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-login.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
if (process.argv[2] !== "login" || process.argv[3]) process.exit(3);
if (!process.env.CODEX_HOME || !process.env.CODEX_HOME.endsWith("browser-login")) process.exit(4);
process.stdout.write("Starting local login server on http://localhost:1455.\\n");
process.stdout.write("https://auth.openai.com/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback\\n");
setInterval(() => {}, 1000);
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "browser-login", displayName: "Browser Login" });
    const login = await openCodexProfileLogin("browser-login");
    assert.equal(login.profileId, "browser-login");
    assert.equal(login.authMode, "secure_chatgpt");
    assert.match(login.authorizationUrl, /^https:\/\/auth\.openai\.com\/oauth\/authorize/);
    assert.equal(login.status, "waiting_for_browser");
    assert.doesNotMatch(login.command, /--device-auth/);
    const raw = codexProfileTestHooks.getLoginSessionForTest(login.loginSessionId);
    assert.ok(raw.child.pid);
    assert.equal(raw.child.killed, false);
    assert.equal(getCodexProfileLoginSession("browser-login", login.loginSessionId).status, "waiting_for_browser");
  });
});

test("verifies login status after a successful OAuth callback", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-success.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
if (process.argv[2] === "login" && process.argv[3] === "status") process.exit(0);
if (process.argv[2] !== "login" || process.argv[3]) process.exit(3);
process.stdout.write("Starting local login server on http://localhost:1455.\\n");
process.stdout.write("https://auth.openai.com/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback\\n");
setTimeout(() => process.exit(0), 50);
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "callback-ok", displayName: "Callback OK" });
    const login = await openCodexProfileLogin("callback-ok");
    const connected = await waitFor(() => {
      const status = getCodexProfileLoginSession("callback-ok", login.loginSessionId);
      return status.status === "connected" ? status : null;
    });
    assert.equal(connected.status, "connected");
    assert.equal(listCodexProfiles().find((profile) => profile.id === "callback-ok").status, "connected");
  });
});

test("rejects device-code output as unexpected_device_auth", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-device-disabled.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
process.stderr.write('Enable device code authorization for Codex in ChatGPT Security Settings, then run "codex login --device-auth" again.\\n');
process.stderr.write('https://auth.openai.com/codex/device\\nEnter this one-time code ABCD-12345\\n');
setInterval(() => {}, 1000);
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "device-disabled", displayName: "Device Disabled" });
    await assert.rejects(
      () => openCodexProfileLogin("device-disabled"),
      (error) => {
        assert.equal(error.code, "unexpected_device_auth");
        assert.equal(error.settingsUrl, "https://chatgpt.com/#settings/Security");
        assert.match(error.message, /Security Settings/);
        return true;
      }
    );
  });
});

test("marks a login session failed when the OAuth child exits with an error", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-failed-login.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
if (process.argv[2] === "login" && process.argv[3] === "status") process.exit(1);
if (process.argv[2] !== "login" || process.argv[3]) process.exit(3);
process.stdout.write("Starting local login server on http://localhost:1455.\\n");
process.stdout.write("https://auth.openai.com/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback\\n");
setTimeout(() => process.exit(7), 50);
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "login-fails", displayName: "Login Fails" });
    const login = await openCodexProfileLogin("login-fails");
    const failed = await waitFor(() => {
      const status = getCodexProfileLoginSession("login-fails", login.loginSessionId);
      return status.status === "failed" ? status : null;
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.exitCode, 7);
  });
});

test("expires a login session when no browser OAuth URL is produced", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-timeout.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
if (process.argv[2] !== "login" || process.argv[3]) process.exit(3);
setInterval(() => {}, 1000);
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin, CODEX_LOGIN_URL_TIMEOUT_MS: "50" }, async () => {
    createCodexProfile({ id: "login-timeout", displayName: "Login Timeout" });
    await assert.rejects(() => openCodexProfileLogin("login-timeout"), /browser OAuth authorization URL/);
  });
});

test("expires an abandoned browser OAuth session and terminates the child", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-abandoned.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
if (process.argv[2] !== "login" || process.argv[3]) process.exit(3);
process.stdout.write("Starting local login server on http://localhost:1455.\\n");
process.stdout.write("https://auth.openai.com/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback\\n");
setInterval(() => {}, 1000);
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin, CODEX_LOGIN_SESSION_TIMEOUT_MS: "1000" }, async () => {
    createCodexProfile({ id: "abandoned-login", displayName: "Abandoned Login" });
    const login = await openCodexProfileLogin("abandoned-login");
    const expired = await waitFor(() => {
      const status = getCodexProfileLoginSession("abandoned-login", login.loginSessionId);
      return status.status === "expired" ? status : null;
    }, { timeoutMs: 2500 });
    assert.equal(expired.status, "expired");
    assert.equal(codexProfileTestHooks.getLoginSessionForTest(login.loginSessionId).child.killed, true);
  });
});

test("returns the existing active session for duplicate profile login requests", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-duplicate.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
if (process.argv[2] !== "login" || process.argv[3]) process.exit(3);
process.stdout.write("Starting local login server on http://localhost:1455.\\n");
process.stdout.write("https://auth.openai.com/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback\\n");
setInterval(() => {}, 1000);
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "duplicate-login", displayName: "Duplicate Login" });
    const first = await openCodexProfileLogin("duplicate-login");
    const second = await openCodexProfileLogin("duplicate-login");
    assert.equal(second.loginSessionId, first.loginSessionId);
    assert.equal(second.authorizationUrl, first.authorizationUrl);
  });
});

test("uses isolated CODEX_HOME values for simultaneous profile login sessions", async () => {
  const fixture = tempProfileEnv();
  const homesFile = path.join(fixture.root, "homes.log");
  const mockBin = path.join(fixture.root, "mock-codex-isolated.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(homesFile)}, process.env.CODEX_HOME + "\\n");
if (process.argv[2] !== "login" || process.argv[3]) process.exit(3);
process.stdout.write("Starting local login server on http://localhost:1455.\\n");
process.stdout.write("https://auth.openai.com/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback\\n");
setInterval(() => {}, 1000);
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "isolated-a", displayName: "Isolated A" });
    createCodexProfile({ id: "isolated-b", displayName: "Isolated B" });
    await openCodexProfileLogin("isolated-a");
    await openCodexProfileLogin("isolated-b");
    const homes = fs.readFileSync(homesFile, "utf8").trim().split(/\n/);
    assert.ok(homes.includes(path.join(fixture.root, "isolated-a")));
    assert.ok(homes.includes(path.join(fixture.root, "isolated-b")));
  });
});

test("requires login before enabling a Codex profile", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-fail.sh");
  fs.writeFileSync(mockBin, "#!/usr/bin/env bash\n[ \"$1 $2\" = \"login status\" ] || exit 3\necho 'not logged in' >&2\nexit 1\n");
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "needs-login", enabled: false });
    await assert.rejects(
      () => enableCodexProfile("needs-login"),
      (error) => {
        assert.equal(error.code, "CODEX_PROFILE_LOGIN_REQUIRED");
        assert.match(error.login.command, /codex login/);
        return true;
      }
    );
    const profile = listCodexProfiles().find((row) => row.id === "needs-login");
    assert.equal(profile.enabled, false);
    assert.equal(profile.status, "disconnected");
  });
});

test("enables a Codex profile only after login status succeeds", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-ok.sh");
  fs.writeFileSync(mockBin, "#!/usr/bin/env bash\n[ \"$1 $2\" = \"login status\" ] || exit 3\n[ -n \"$CODEX_HOME\" ] || exit 4\nexit 0\n");
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "ready", enabled: false });
    const profiles = await enableCodexProfile("ready");
    const profile = profiles.find((row) => row.id === "ready");
    assert.equal(profile.enabled, true);
    assert.equal(profile.status, "connected");
  });
});

test("refreshes usage limit data from the Codex app-server", async () => {
  const fixture = tempProfileEnv();
  const mockBin = path.join(fixture.root, "mock-codex-usage.mjs");
  fs.writeFileSync(mockBin, `#!/usr/bin/env node
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: msg.id, result: { codexHome: process.env.CODEX_HOME } }) + "\\n");
    return;
  }
  if (msg.method === "account/rateLimits/read") {
    process.stdout.write(JSON.stringify({
      id: msg.id,
      result: {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1783821713 },
          secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1784408513 },
          credits: { hasCredits: false, unlimited: false, balance: "0" },
          planType: "plus"
        },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1783821713 },
            secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1784408513 },
            planType: "plus"
          }
        },
        rateLimitResetCredits: { availableCount: 1 }
      }
    }) + "\\n");
    return;
  }
  if (msg.method === "account/usage/read") {
    process.stdout.write(JSON.stringify({
      id: msg.id,
      result: { summary: { lifetimeTokens: 12345, currentStreakDays: 2 }, dailyUsageBuckets: [] }
    }) + "\\n");
  }
});
`);
  fs.chmodSync(mockBin, 0o755);
  await withEnvAsync({ ...fixture.env, CODEX_BIN: mockBin }, async () => {
    createCodexProfile({ id: "usage-id" });
    const result = await refreshCodexProfileUsage("usage-id");
    assert.equal(result.usageLimit.status, "available");
    assert.equal(result.usageLimit.rateLimitsByLimitId.codex.primary.usedPercent, 25);
    assert.equal(result.usageLimit.rateLimitResetCredits.availableCount, 1);
    assert.equal(result.usageLimit.usage.summary.lifetimeTokens, 12345);
    const profile = listCodexProfiles().find((row) => row.id === "usage-id");
    assert.equal(profile.usageLimit.rateLimitsByLimitId.codex.secondary.windowDurationMins, 10080);
  });
});

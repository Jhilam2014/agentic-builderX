import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { sanitizeAgentProcessEnv } from "./providerAuth.js";

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROFILE_STATUSES = new Set(["unknown", "connected", "disconnected", "unavailable", "limit_reached", "invalid"]);
const SELECTION_MODES = new Set(["manual", "default", "fallback_on_limit", "round_robin", "least_recently_used"]);
const DEFAULT_TIMEOUT_MS = 8000;
const USAGE_TIMEOUT_MS = 12000;
const LOGIN_URL_TIMEOUT_MS = 10000;
const LOGIN_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const CHATGPT_SECURITY_SETTINGS_URL = "https://chatgpt.com/#settings/Security";
const COMPATIBILITY_PROFILE_ID = "default";
let roundRobinIndex = 0;
const loginSessions = new Map();
const loginSessionsByProfile = new Map();

function repoRoot() {
  if (process.env.BUILDERX_PROJECT_ROOT) return path.resolve(process.env.BUILDERX_PROJECT_ROOT);
  if (fs.existsSync(path.join(process.cwd(), "apps", "backend"))) return process.cwd();
  return path.resolve(process.cwd(), "../..");
}

function expandHome(value = "") {
  const text = String(value || "").trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function normalizeAbsolutePath(value = "") {
  const expanded = expandHome(value);
  if (!expanded || expanded.includes("\0")) throw new Error("Codex profile path is missing or unsafe.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(expanded)) throw new Error("Codex profile path must be a local filesystem path.");
  if (!path.isAbsolute(expanded)) throw new Error("Codex profile path must be absolute.");
  return path.normalize(expanded);
}

function existingRealPath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function nearestExistingAncestor(value) {
  let current = value;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current)) return current;
    current = path.dirname(current);
  }
  return fs.existsSync(current) ? current : null;
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateCodexProfileId(value = "") {
  const id = String(value || "").trim();
  if (!id) throw new Error("Codex profile id is required.");
  if (id.includes("\0")) throw new Error("Codex profile id contains an unsafe null byte.");
  if (!PROFILE_ID_PATTERN.test(id)) {
    throw new Error("Codex profile id may use letters, numbers, period, underscore, and hyphen only, up to 64 characters.");
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\") || path.isAbsolute(id)) {
    throw new Error("Codex profile id must not contain path traversal or path separators.");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(id)) throw new Error("Codex profile id must not be a URI.");
  return id;
}

function profileKey(id = "") {
  return validateCodexProfileId(id).toLowerCase();
}

export function codexProfilesRoot() {
  return normalizeAbsolutePath(process.env.CODEX_PROFILES_ROOT || path.join(os.homedir(), ".codex-profiles"));
}

function registryPath() {
  const configured = process.env.CODEX_PROFILE_REGISTRY_PATH || path.join("runtime", "codex-profiles.json");
  const expanded = expandHome(configured);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.join(repoRoot(), expanded);
}

function isoNow() {
  return new Date().toISOString();
}

function defaultObservedUsage() {
  return {
    executions: 0,
    successfulExecutions: 0,
    failedExecutions: 0
  };
}

function defaultUsageLimitSnapshot() {
  return {
    status: "unknown",
    lastCheckedAt: "",
    errorCode: "",
    error: "",
    rateLimits: null,
    rateLimitsByLimitId: {},
    rateLimitResetCredits: null,
    usage: null
  };
}

function compatibilityProfile() {
  const now = isoNow();
  return {
    id: COMPATIBILITY_PROFILE_ID,
    displayName: "Existing Codex CLI session",
    relativeDirectory: null,
    usesDefaultCodexHome: true,
    enabled: true,
    isDefault: true,
    priority: 100,
    status: "unknown",
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: "",
    lastUsedAt: "",
    unavailableUntil: "",
    lastErrorCode: "",
    observedUsage: defaultObservedUsage()
  };
}

function registryMissingDefaultRows() {
  return fs.existsSync(path.join(os.homedir(), ".codex")) ? [compatibilityProfile()] : [];
}

function relativeDirectoryForId(id) {
  return validateCodexProfileId(id);
}

export function resolveCodexProfileHome(profile = {}) {
  if (profile.usesDefaultCodexHome) {
    const defaultHome = normalizeAbsolutePath(path.join(os.homedir(), ".codex"));
    if (fs.existsSync(defaultHome) && fs.lstatSync(defaultHome).isSymbolicLink()) {
      throw new Error("Default Codex home symlink profiles are not supported.");
    }
    return defaultHome;
  }
  const root = codexProfilesRoot();
  const relativeDirectory = String(profile.relativeDirectory || relativeDirectoryForId(profile.id));
  const resolved = path.resolve(root, relativeDirectory);
  if (!pathInside(resolved, root)) throw new Error("Resolved Codex profile directory escaped CODEX_PROFILES_ROOT.");
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isFile()) throw new Error("Codex profile directory points to a file.");
    if (stat.isSymbolicLink()) {
      const realProfile = fs.realpathSync(resolved);
      const realRoot = existingRealPath(root) || root;
      if (!pathInside(realProfile, realRoot)) throw new Error("Codex profile symlink resolves outside CODEX_PROFILES_ROOT.");
    }
  } else {
    const ancestor = nearestExistingAncestor(path.dirname(resolved));
    const realAncestor = ancestor ? existingRealPath(ancestor) : null;
    const realRoot = existingRealPath(root) || root;
    if (realAncestor && !pathInside(realAncestor, realRoot) && !pathInside(root, realAncestor)) {
      throw new Error("Codex profile parent directory escaped CODEX_PROFILES_ROOT.");
    }
  }
  return resolved;
}

function migrateLegacyProfile(row = {}) {
  const id = validateCodexProfileId(row.id || COMPATIBILITY_PROFILE_ID);
  if (row.relativeDirectory || row.usesDefaultCodexHome) return row;
  if (row.codexHome) {
    const codexHome = normalizeAbsolutePath(row.codexHome);
    const defaultHome = normalizeAbsolutePath(path.join(os.homedir(), ".codex"));
    if (codexHome === defaultHome) return { ...row, relativeDirectory: null, usesDefaultCodexHome: true };
    const root = codexProfilesRoot();
    if (pathInside(codexHome, root)) return { ...row, relativeDirectory: path.relative(root, codexHome), usesDefaultCodexHome: false };
  }
  return { ...row, relativeDirectory: relativeDirectoryForId(id), usesDefaultCodexHome: false };
}

function sanitizeProfile(row = {}, index = 0) {
  const migrated = migrateLegacyProfile(row);
  const id = validateCodexProfileId(migrated.id);
  const relativeDirectory = migrated.usesDefaultCodexHome ? null : relativeDirectoryForId(migrated.relativeDirectory || id);
  const status = PROFILE_STATUSES.has(migrated.status) ? migrated.status : "unknown";
  const now = isoNow();
  const profile = {
    id,
    displayName: String(migrated.displayName || id).trim().slice(0, 80) || id,
    relativeDirectory,
    usesDefaultCodexHome: Boolean(migrated.usesDefaultCodexHome),
    enabled: migrated.enabled !== false,
    isDefault: Boolean(migrated.isDefault),
    priority: Number.isFinite(Number(migrated.priority)) ? Number(migrated.priority) : index + 1,
    status,
    createdAt: String(migrated.createdAt || now),
    updatedAt: String(migrated.updatedAt || now),
    lastCheckedAt: String(migrated.lastCheckedAt || ""),
    lastUsedAt: String(migrated.lastUsedAt || ""),
    unavailableUntil: String(migrated.unavailableUntil || ""),
    lastErrorCode: String(migrated.lastErrorCode || ""),
    observedUsage: {
      ...defaultObservedUsage(),
      ...(typeof migrated.observedUsage === "object" && migrated.observedUsage ? migrated.observedUsage : {})
    },
    usageLimit: sanitizeUsageLimitSnapshot(migrated.usageLimit)
  };
  resolveCodexProfileHome(profile);
  return profile;
}

function withDerivedProfileFields(profile) {
  const codexHome = resolveCodexProfileHome(profile);
  return {
    ...profile,
    codexHome,
    loginCommand: loginCommandForProfile({ ...profile, codexHome })
  };
}

function normalizeRegistry(rows) {
  const byKey = new Map();
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const profile = sanitizeProfile(row, index);
    const key = profile.id.toLowerCase();
    if (byKey.has(key)) throw new Error("Duplicate Codex profile id in registry.");
    byKey.set(key, profile);
  }
  let defaultSeen = false;
  return [...byKey.values()].map((profile) => {
    if (!profile.isDefault) return profile;
    if (defaultSeen) return { ...profile, isDefault: false };
    defaultSeen = true;
    return profile;
  }).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function readRegistryPayload() {
  const filePath = registryPath();
  if (!fs.existsSync(filePath)) return registryMissingDefaultRows();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : parsed.profiles;
  } catch {
    return registryMissingDefaultRows();
  }
}

export function readCodexProfileRegistry({ includeDerived = false } = {}) {
  const rows = normalizeRegistry(readRegistryPayload());
  return includeDerived ? rows.map(withDerivedProfileFields) : rows;
}

export function writeCodexProfileRegistry(profiles) {
  const filePath = registryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const normalized = normalizeRegistry(profiles).map((profile) => {
    const { codexHome, loginCommand, ...safeProfile } = profile;
    return safeProfile;
  });
  fs.writeFileSync(tempPath, `${JSON.stringify({ schemaVersion: 2, profiles: normalized }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  return readCodexProfileRegistry();
}

function sanitizeUsageLimitSnapshot(value = null) {
  const fallback = defaultUsageLimitSnapshot();
  if (!value || typeof value !== "object") return fallback;
  const status = ["unknown", "available", "unavailable", "error"].includes(value.status) ? value.status : "unknown";
  return {
    ...fallback,
    status,
    lastCheckedAt: String(value.lastCheckedAt || ""),
    errorCode: String(value.errorCode || ""),
    error: boundedOutput(value.error || ""),
    rateLimits: value.rateLimits && typeof value.rateLimits === "object" ? value.rateLimits : null,
    rateLimitsByLimitId: value.rateLimitsByLimitId && typeof value.rateLimitsByLimitId === "object" ? value.rateLimitsByLimitId : {},
    rateLimitResetCredits: value.rateLimitResetCredits && typeof value.rateLimitResetCredits === "object" ? value.rateLimitResetCredits : null,
    usage: value.usage && typeof value.usage === "object" ? value.usage : null
  };
}

export function listCodexProfiles() {
  return readCodexProfileRegistry({ includeDerived: true });
}

export function createCodexProfile(input = {}) {
  const current = readCodexProfileRegistry();
  const id = validateCodexProfileId(input.id);
  if (current.some((row) => row.id.toLowerCase() === id.toLowerCase())) throw new Error("Codex profile id already exists.");
  const now = isoNow();
  const profile = sanitizeProfile({
    id,
    displayName: input.displayName || id,
    relativeDirectory: relativeDirectoryForId(id),
    usesDefaultCodexHome: false,
    enabled: input.enabled !== false,
    isDefault: Boolean(input.isDefault),
    priority: input.priority ?? current.length + 1,
    status: "disconnected",
    createdAt: now,
    updatedAt: now
  }, current.length);
  const profileHome = resolveCodexProfileHome(profile);
  fs.mkdirSync(codexProfilesRoot(), { recursive: true, mode: 0o700 });
  fs.mkdirSync(profileHome, { recursive: true, mode: 0o700 });
  fs.chmodSync(profileHome, 0o700);
  const next = profile.isDefault ? current.map((row) => ({ ...row, isDefault: false, updatedAt: now })) : current;
  const profiles = writeCodexProfileRegistry([...next, profile]);
  const derivedProfile = withDerivedProfileFields(profile);
  return {
    profiles: profiles.map(withDerivedProfileFields),
    profile: derivedProfile,
    login: {
      required: true,
      command: derivedProfile.loginCommand
    },
    message: "Profile metadata created. Local Codex credentials are not created until you run the login command."
  };
}

export function updateCodexProfile(profileId, input = {}) {
  const current = readCodexProfileRegistry();
  const key = profileKey(profileId);
  const index = current.findIndex((row) => row.id.toLowerCase() === key);
  if (index === -1) throw new Error("Codex profile was not found.");
  if (input.id && profileKey(input.id) !== key) throw new Error("Codex profile id cannot be renamed.");
  const allowed = {
    ...current[index],
    displayName: input.displayName ?? current[index].displayName,
    enabled: input.enabled ?? current[index].enabled,
    isDefault: input.isDefault ?? current[index].isDefault,
    priority: input.priority ?? current[index].priority,
    status: input.status ?? current[index].status,
    lastCheckedAt: input.lastCheckedAt ?? current[index].lastCheckedAt,
    lastUsedAt: input.lastUsedAt ?? current[index].lastUsedAt,
    unavailableUntil: input.unavailableUntil ?? current[index].unavailableUntil,
    lastErrorCode: input.lastErrorCode ?? current[index].lastErrorCode,
    observedUsage: input.observedUsage ?? current[index].observedUsage,
    usageLimit: input.usageLimit ?? current[index].usageLimit,
    updatedAt: isoNow()
  };
  const merged = sanitizeProfile(allowed, index);
  const next = current.map((row, rowIndex) => rowIndex === index ? merged : row);
  return writeCodexProfileRegistry(next).map(withDerivedProfileFields);
}

export function deleteCodexProfile(profileId) {
  const current = readCodexProfileRegistry();
  const key = profileKey(profileId);
  const target = current.find((row) => row.id.toLowerCase() === key);
  if (!target) throw new Error("Codex profile was not found.");
  if (target.isDefault && current.length > 1) throw new Error("Set another default profile before deleting this one.");
  return {
    profiles: writeCodexProfileRegistry(current.filter((row) => row.id.toLowerCase() !== key)).map(withDerivedProfileFields),
    message: "Profile metadata was deleted. The local CODEX_HOME directory was retained."
  };
}

export function setDefaultCodexProfile(profileId) {
  const current = readCodexProfileRegistry();
  const key = profileKey(profileId);
  if (!current.some((row) => row.id.toLowerCase() === key)) throw new Error("Codex profile was not found.");
  const now = isoNow();
  return writeCodexProfileRegistry(current.map((row) => ({ ...row, isDefault: row.id.toLowerCase() === key, updatedAt: now }))).map(withDerivedProfileFields);
}

function cooldownUntil() {
  const minutes = Math.max(1, Number(process.env.CODEX_PROFILE_LIMIT_COOLDOWN_MINUTES || 60));
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export function markCodexProfileAvailable(profileId) {
  return updateCodexProfile(profileId, { status: "unknown", unavailableUntil: "", lastErrorCode: "" });
}

export function markCodexProfileUnavailable(profileId, errorCode = "manual_unavailable") {
  return updateCodexProfile(profileId, { status: errorCode === "usage_limit" ? "limit_reached" : "unavailable", unavailableUntil: cooldownUntil(), lastErrorCode: errorCode });
}

function findCodexProfile(profileId) {
  const profile = profileById(readCodexProfileRegistry({ includeDerived: true }), profileId);
  if (!profile) throw new Error("Codex profile was not found.");
  return profile;
}

export function loginCommandForProfile(profile) {
  const codexHome = profile.codexHome || resolveCodexProfileHome(profile);
  const quoted = String(codexHome).replace(/"/g, '\\"');
  return `CODEX_HOME="${quoted}" codex login`;
}

function loginUrlTimeoutMs() {
  return Math.max(100, Number(process.env.CODEX_LOGIN_URL_TIMEOUT_MS || LOGIN_URL_TIMEOUT_MS));
}

function loginSessionTimeoutMs() {
  return Math.max(1000, Number(process.env.CODEX_LOGIN_SESSION_TIMEOUT_MS || LOGIN_SESSION_TIMEOUT_MS));
}

function codexCommand() {
  return process.env.CODEX_BIN || "codex";
}

function resolveExecutablePath(command) {
  if (path.isAbsolute(command)) return command;
  const lookup = process.platform === "win32"
    ? spawnSync("where", [command], { encoding: "utf8" })
    : spawnSync("which", [command], { encoding: "utf8" });
  const first = String(lookup.stdout || "").split(/\r?\n/).find(Boolean);
  return first || command;
}

function sanitizedArgs(args = []) {
  return args.map((arg) => /token|key|secret|password/i.test(arg) ? "[redacted]" : String(arg));
}

function appendLoginOutput(session, chunk) {
  session.output = boundedOutput(`${session.output || ""}${stripAnsi(chunk)}`);
}

function detectBrowserOAuthOutput(text = "") {
  const output = stripAnsi(text);
  const authorizationUrl = output.match(/https:\/\/auth\.openai\.com\/oauth\/authorize\b[^\s]*/i)?.[0] || "";
  if (!authorizationUrl) return null;
  if (!/local login server|localhost:\d+|auth\/callback|browser did not open/i.test(output)) return null;
  return { authorizationUrl };
}

function callbackPortFromAuthorizationUrl(authorizationUrl = "") {
  try {
    const parsed = new URL(authorizationUrl);
    const redirectUri = parsed.searchParams.get("redirect_uri") || "";
    const redirect = new URL(redirectUri);
    const port = Number(redirect.port || (redirect.protocol === "https:" ? 443 : 80));
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0;
  } catch {
    return 0;
  }
}

function codexLoginCallbackProxyPort() {
  const raw = process.env.CODEX_LOGIN_CALLBACK_PROXY_PORT || "1456";
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0;
}

function closeLoginCallbackProxy(session) {
  if (!session?.callbackProxyServer) return;
  const server = session.callbackProxyServer;
  session.callbackProxyServer = null;
  try {
    server.close();
  } catch {
    // best-effort cleanup only
  }
}

function startLoginCallbackProxy(session, targetPort) {
  const proxyPort = codexLoginCallbackProxyPort();
  if (!proxyPort || !targetPort || proxyPort === targetPort || session.callbackProxyServer) return;
  const server = net.createServer((clientSocket) => {
    const upstream = net.connect({ host: "127.0.0.1", port: targetPort });
    const closeBoth = () => {
      clientSocket.destroy();
      upstream.destroy();
    };
    clientSocket.on("error", closeBoth);
    upstream.on("error", closeBoth);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
  server.on("error", (error) => {
    appendLoginOutput(session, `\n[BuilderX] Codex callback proxy failed on 0.0.0.0:${proxyPort}: ${error.message}\n`);
  });
  server.listen(proxyPort, "0.0.0.0", () => {
    appendLoginOutput(session, `\n[BuilderX] Forwarding host callback port ${targetPort} through container port ${proxyPort}.\n`);
  });
  session.callbackProxyServer = server;
}

function detectDeviceCodeOutput(text = "") {
  const output = stripAnsi(text);
  const authUrl = output.match(/https:\/\/auth\.openai\.com\/codex\/device\b[^\s]*/i)?.[0] || "";
  const deviceCode = output.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/)?.[0] || "";
  if (!authUrl && !deviceCode && !/device code authorization|device code/i.test(output)) return null;
  return { authUrl, deviceCode };
}

function publicLoginSession(session, { includeProfiles = false } = {}) {
  const snapshot = {
    loginSessionId: session.loginSessionId,
    profileId: session.profileId,
    authorizationUrl: session.authorizationUrl || "",
    status: session.status,
    authMode: session.authMode || "",
    message: session.message || "",
    command: loginCommandForProfile(findCodexProfile(session.profileId)),
    output: boundedOutput(session.output || ""),
    startedAt: session.startedAt,
    exitCode: session.exitCode ?? null,
    error: session.error || "",
    executablePath: session.executablePath,
    args: sanitizedArgs(session.args || [])
  };
  if (includeProfiles) snapshot.profiles = listCodexProfiles();
  return snapshot;
}

function isActiveLoginStatus(status) {
  return ["starting", "waiting_for_browser", "verifying"].includes(status);
}

function finishLoginSession(session, patch = {}) {
  Object.assign(session, patch);
  clearTimeout(session.urlTimer);
  if (!isActiveLoginStatus(session.status)) {
    closeLoginCallbackProxy(session);
    clearTimeout(session.expiryTimer);
    if (loginSessionsByProfile.get(session.profileId) === session.loginSessionId) {
      loginSessionsByProfile.delete(session.profileId);
    }
  }
}

function expireLoginSession(session) {
  if (!isActiveLoginStatus(session.status)) return;
  if (session.child && !session.child.killed) session.child.kill("SIGTERM");
  finishLoginSession(session, {
    status: "expired",
    error: "Codex login session expired before BuilderX observed a completed sign-in."
  });
}

async function verifyLoginSession(session) {
  finishLoginSession(session, { status: "verifying" });
  const result = await validateCodexProfile(session.profileId);
  if (result.ok) {
    finishLoginSession(session, { status: "connected", error: "" });
  } else {
    finishLoginSession(session, {
      status: "failed",
      error: result.output || "Codex login exited successfully, but login status verification failed."
    });
  }
}

function activeLoginSessionForProfile(profileId) {
  const existingId = loginSessionsByProfile.get(profileId);
  const existing = existingId ? loginSessions.get(existingId) : null;
  if (!existing || !isActiveLoginStatus(existing.status)) return null;
  return existing;
}

function cancelActiveLoginSessionForProfile(profileId, reason = "A new Codex login was requested.") {
  const existing = activeLoginSessionForProfile(profileId);
  if (!existing) return null;
  if (existing.child && !existing.child.killed) existing.child.kill("SIGTERM");
  finishLoginSession(existing, {
    status: "cancelled",
    error: reason
  });
  return existing;
}

export function getCodexProfileLoginSession(profileId, loginSessionId) {
  const session = loginSessions.get(String(loginSessionId || ""));
  if (!session || session.profileId !== validateCodexProfileId(profileId)) {
    const error = new Error("Codex login session was not found.");
    error.code = "CODEX_LOGIN_SESSION_NOT_FOUND";
    throw error;
  }
  return publicLoginSession(session);
}

export function cleanupCodexProfileLoginSessions() {
  for (const session of loginSessions.values()) {
    if (session.child && !session.child.killed && isActiveLoginStatus(session.status)) session.child.kill("SIGTERM");
    clearTimeout(session.urlTimer);
    clearTimeout(session.expiryTimer);
  }
  loginSessions.clear();
  loginSessionsByProfile.clear();
}

export function openCodexProfileLogin(profileId) {
  const profile = findCodexProfile(profileId);
  const existing = activeLoginSessionForProfile(profile.id);
  if (existing) return Promise.resolve(publicLoginSession(existing));

  const codexHome = resolveCodexProfileHome(profile);
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });

  const command = codexCommand();
  const args = ["login"];
  const executablePath = resolveExecutablePath(command);
  console.log(`[codex-profile-login] profile=${profile.id} executable=${executablePath} args=${JSON.stringify(sanitizedArgs(args))}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...buildCodexProfileEnv(profile), NO_COLOR: "1" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const session = {
      loginSessionId: crypto.randomUUID(),
      profileId: profile.id,
      child,
      authorizationUrl: "",
      status: "starting",
      output: "",
      startedAt: isoNow(),
      exitCode: null,
      error: "",
      profileHome: codexHome,
      command,
      executablePath,
      args,
      urlTimer: null,
      expiryTimer: null,
      callbackProxyServer: null,
      resolvedStart: false
    };
    loginSessions.set(session.loginSessionId, session);
    loginSessionsByProfile.set(profile.id, session.loginSessionId);

    const resolveStart = () => {
      if (session.resolvedStart) return;
      session.resolvedStart = true;
      clearTimeout(session.urlTimer);
      resolve(publicLoginSession(session));
    };
    const rejectStart = (error) => {
      if (session.resolvedStart) return;
      session.resolvedStart = true;
      clearTimeout(session.urlTimer);
      reject(error);
    };
    const parseLogin = () => {
      const text = session.output;
      if (detectDeviceCodeOutput(text)) {
        const settingsError = codexDeviceAuthSettingsError(text);
        const error = settingsError || new Error("Codex produced a device-code login prompt while BuilderX requested secure ChatGPT browser sign-in.");
        error.code = "unexpected_device_auth";
        error.output = boundedOutput(text);
        child.kill("SIGTERM");
        finishLoginSession(session, { status: "failed", error: error.message });
        rejectStart(error);
        return;
      }
      const browser = detectBrowserOAuthOutput(text);
      if (!browser) return;
      session.authorizationUrl = browser.authorizationUrl;
      startLoginCallbackProxy(session, callbackPortFromAuthorizationUrl(browser.authorizationUrl));
      session.status = "waiting_for_browser";
      session.authMode = "secure_chatgpt";
      session.message = `Secure sign in with ChatGPT for ${profile.displayName}, then return to BuilderX.`;
      resolveStart();
    };
    session.urlTimer = setTimeout(() => {
      child.kill("SIGTERM");
      const error = codexDeviceAuthSettingsError(session.output) || new Error("Codex login page could not be opened because no browser OAuth authorization URL was produced.");
      error.output = error.output || boundedOutput(session.output);
      finishLoginSession(session, { status: "expired", error: error.message });
      rejectStart(error);
    }, loginUrlTimeoutMs());
    session.expiryTimer = setTimeout(() => expireLoginSession(session), loginSessionTimeoutMs());
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      appendLoginOutput(session, chunk);
      parseLogin();
    });
    child.stderr.on("data", (chunk) => {
      appendLoginOutput(session, chunk);
      parseLogin();
    });
    child.on("error", (error) => {
      finishLoginSession(session, { status: "failed", error: error.message });
      rejectStart(error);
    });
    child.on("close", (code, signal) => {
      session.exitCode = code;
      if (session.status === "expired") return;
      if (detectDeviceCodeOutput(session.output)) {
        const settingsError = codexDeviceAuthSettingsError(session.output);
        const error = settingsError || new Error("Codex produced a device-code login prompt while BuilderX requested secure ChatGPT browser sign-in.");
        error.code = "unexpected_device_auth";
        error.output = boundedOutput(session.output);
        finishLoginSession(session, { status: "failed", error: error.message, exitCode: code });
        rejectStart(error);
        return;
      }
      if (code === 0 && !signal) {
        resolveStart();
        verifyLoginSession(session).catch((error) => {
          finishLoginSession(session, { status: "failed", error: error.message || "Codex login verification failed." });
        });
        return;
      }
      const error = new Error(code == null ? `Codex login exited with signal ${signal}.` : `Codex login exited with code ${code}.`);
      error.output = boundedOutput(session.output);
      finishLoginSession(session, { status: "failed", error: error.message, exitCode: code });
      rejectStart(error);
    });
  });
}

function isCoolingDown(profile) {
  return profile.unavailableUntil && new Date(profile.unavailableUntil).getTime() > Date.now();
}

function enabledAvailableProfiles() {
  return readCodexProfileRegistry({ includeDerived: true }).filter((profile) => profile.enabled && !isCoolingDown(profile));
}

function fallbackOrder() {
  return String(process.env.CODEX_PROFILE_FALLBACK_ORDER || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function profileById(profiles, id) {
  const key = profileKey(id);
  return profiles.find((profile) => profile.id.toLowerCase() === key);
}

export function selectCodexProfile({ requestedProfileId = "", strategy = "" } = {}) {
  const profiles = enabledAvailableProfiles();
  if (!profiles.length) throw new Error("No enabled Codex profiles are configured.");
  if (requestedProfileId) {
    const requested = profileById(profiles, requestedProfileId);
    if (!requested) throw new Error("Requested Codex profile is not enabled or does not exist.");
    return requested;
  }

  const defaultId = String(process.env.CODEX_DEFAULT_PROFILE_ID || "").trim();
  if (defaultId) {
    const configuredDefault = profileById(profiles, defaultId);
    if (!configuredDefault) throw new Error("Configured CODEX_DEFAULT_PROFILE_ID is not registered or enabled.");
    return configuredDefault;
  }

  const connected = profiles.filter((profile) => profile.status === "connected");
  if (connected.length === 1) return connected[0];

  const mode = SELECTION_MODES.has(strategy) ? strategy : (SELECTION_MODES.has(process.env.CODEX_PROFILE_SELECTION_MODE) ? process.env.CODEX_PROFILE_SELECTION_MODE : "manual");
  if (mode === "fallback_on_limit") {
    if (process.env.CODEX_ALLOW_AUTOMATIC_PROFILE_FALLBACK !== "true") throw new Error("Select a Codex profile before running this task.");
    const order = fallbackOrder();
    const selected = order.map((id) => profileById(profiles, id)).find(Boolean);
    if (selected) return selected;
    throw new Error("No configured fallback Codex profile is available.");
  }
  if (mode === "round_robin") {
    const profile = profiles[roundRobinIndex % profiles.length];
    roundRobinIndex += 1;
    return profile;
  }
  if (mode === "least_recently_used") {
    return [...profiles].sort((a, b) => new Date(a.lastUsedAt || 0).getTime() - new Date(b.lastUsedAt || 0).getTime())[0];
  }
  if (mode === "default") {
    const registryDefault = profiles.find((profile) => profile.isDefault);
    if (registryDefault) return registryDefault;
  }
  throw new Error("Select a Codex profile before running this task.");
}

function codexLoginCallbackPort() {
  const raw = process.env.CODEX_LOGIN_CALLBACK_PORT || process.env.CODEX_LOGIN_PORT || "";
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port < 65536 ? String(port) : "";
}

function sanitizeCodexProfileEnv(baseEnv = process.env) {
  const env = sanitizeAgentProcessEnv(baseEnv);
  // Codex login starts its own localhost callback server. Do not let BuilderX's
  // frontend/backend PORT leak into that child process, otherwise the OpenAI
  // redirect can land back on the BuilderX app (for example /auth/callback on
  // localhost:1455) instead of the Codex CLI callback listener.
  delete env.PORT;
  delete env.HOST;
  delete env.FRONTEND_PORT;
  delete env.BACKEND_PORT;
  const callbackPort = codexLoginCallbackPort();
  if (callbackPort) env.PORT = callbackPort;
  return env;
}

export function buildCodexProfileEnv(profile, baseEnv = process.env) {
  return {
    ...sanitizeCodexProfileEnv(baseEnv),
    CODEX_HOME: resolveCodexProfileHome(profile)
  };
}

function incrementUsage(profile, patch = {}) {
  const usage = {
    ...defaultObservedUsage(),
    ...(profile.observedUsage || {})
  };
  for (const [key, value] of Object.entries(patch)) {
    usage[key] = Number(usage[key] || 0) + Number(value || 0);
  }
  return usage;
}

export function recordCodexProfileUsed(profileId) {
  if (!profileId) return readCodexProfileRegistry({ includeDerived: true });
  const current = readCodexProfileRegistry();
  const key = profileKey(profileId);
  const now = isoNow();
  return writeCodexProfileRegistry(current.map((profile) => profile.id.toLowerCase() === key
    ? { ...profile, lastUsedAt: now, updatedAt: now, observedUsage: incrementUsage(profile, { executions: 1 }) }
    : profile
  )).map(withDerivedProfileFields);
}

export function recordCodexProfileResult(profileId, ok) {
  if (!profileId) return readCodexProfileRegistry({ includeDerived: true });
  const current = readCodexProfileRegistry();
  const key = profileKey(profileId);
  const now = isoNow();
  return writeCodexProfileRegistry(current.map((profile) => profile.id.toLowerCase() === key
    ? {
        ...profile,
        updatedAt: now,
        observedUsage: incrementUsage(profile, ok ? { successfulExecutions: 1 } : { failedExecutions: 1 })
      }
    : profile
  )).map(withDerivedProfileFields);
}

function boundedOutput(value = "") {
  return String(value || "").replace(/\b(sk-[A-Za-z0-9_-]+|[A-Za-z0-9_-]{32,})\b/g, "[redacted]").slice(-1200);
}

function stripAnsi(value = "") {
  return String(value || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function codexDeviceAuthSettingsError(output = "") {
  const text = stripAnsi(output);
  if (!/device code authorization/i.test(text) || !/security settings/i.test(text)) return null;
  const error = new Error("Enable device code authorization for Codex in ChatGPT Security Settings, then press Login again.");
  error.code = "CODEX_DEVICE_AUTH_DISABLED";
  error.settingsUrl = CHATGPT_SECURITY_SETTINGS_URL;
  error.output = boundedOutput(text);
  return error;
}

export function validateCodexProfile(profileId, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const profile = findCodexProfile(profileId);
  const command = process.env.CODEX_BIN || "codex";
  return new Promise((resolve) => {
    const child = spawn(command, ["login", "status"], {
      env: { ...buildCodexProfileEnv(profile), CI: "1", NO_COLOR: "1" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-2400); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-2400); });
    child.on("error", (error) => {
      clearTimeout(timer);
      updateCodexProfile(profile.id, { status: "disconnected", lastCheckedAt: isoNow(), lastErrorCode: "codex_unavailable" });
      resolve({ status: "disconnected", profileId: profile.id, ok: false, errorCode: "codex_unavailable", output: boundedOutput(error.message) });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const text = boundedOutput(`${stdout}\n${stderr}`);
      const ok = code === 0 && !signal;
      const errorCode = ok ? "" : (signal ? "validation_timeout" : "login_status_failed");
      updateCodexProfile(profile.id, {
        status: ok ? "connected" : (signal ? "unavailable" : "disconnected"),
        lastCheckedAt: isoNow(),
        lastErrorCode: errorCode
      });
      resolve({ status: ok ? "connected" : (signal ? "unavailable" : "disconnected"), profileId: profile.id, ok, errorCode, exitCode: code, signal, output: text });
    });
  });
}

export async function enableCodexProfile(profileId) {
  const result = await validateCodexProfile(profileId);
  if (!result.ok) {
    const profile = findCodexProfile(profileId);
    const error = new Error("Login required before this Codex profile can be enabled.");
    error.code = "CODEX_PROFILE_LOGIN_REQUIRED";
    error.statusCode = 409;
    error.result = result;
    error.login = {
      required: true,
      command: loginCommandForProfile(profile)
    };
    throw error;
  }
  return updateCodexProfile(profileId, { enabled: true, status: "connected", unavailableUntil: "", lastErrorCode: "" });
}

function parseJsonLines(buffer = "") {
  return String(buffer || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function rpcResult(messages, id, { optional = false } = {}) {
  const message = messages.find((row) => row.id === id);
  if (!message) return null;
  if (message.error) {
    if (optional) return null;
    const error = new Error(message.error.message || "Codex app-server request failed.");
    error.code = message.error.code || "app_server_error";
    throw error;
  }
  return message.result ?? null;
}

function callCodexAppServer(profile, requests, { timeoutMs = USAGE_TIMEOUT_MS } = {}) {
  const command = process.env.CODEX_BIN || "codex";
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["app-server", "--stdio"], {
      env: { ...buildCodexProfileEnv(profile), CI: "1", NO_COLOR: "1" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const sent = new Set();
    const pendingIds = new Set([1, ...requests.map((request) => request.id)]);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      callback(value);
    };
    const send = (payload) => {
      if (child.stdin.destroyed) return;
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    };
    const maybeSendRequests = () => {
      const messages = parseJsonLines(stdout);
      if (!messages.some((message) => message.id === 1 && message.result) || sent.has("requests")) return;
      sent.add("requests");
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
      for (const request of requests) {
        send({ jsonrpc: "2.0", id: request.id, method: request.method, params: request.params || {} });
      }
    };
    const maybeFinish = () => {
      const messages = parseJsonLines(stdout);
      maybeSendRequests();
      if ([...pendingIds].every((id) => messages.some((message) => message.id === id))) {
        try {
          const result = Object.fromEntries(requests.map((request) => [request.key, rpcResult(messages, request.id, { optional: request.optional })]));
          finish(resolve, result);
        } catch (error) {
          finish(reject, error);
        }
      }
    };
    const timer = setTimeout(() => {
      const error = new Error("Timed out while reading Codex usage limits.");
      error.code = "usage_timeout";
      finish(reject, error);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-20000);
      maybeFinish();
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code, signal) => {
      if (settled) return;
      const error = new Error(code == null ? `Codex app-server exited with signal ${signal}.` : `Codex app-server exited with code ${code}.`);
      error.code = "app_server_exited";
      error.output = boundedOutput(stderr);
      finish(reject, error);
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "builderx", version: "0.0.0" },
        protocolVersion: "2025-06-18",
        capabilities: {}
      }
    });
  });
}

function usageErrorSnapshot(error) {
  return {
    ...defaultUsageLimitSnapshot(),
    status: "error",
    lastCheckedAt: isoNow(),
    errorCode: String(error.code || "usage_read_failed"),
    error: boundedOutput(error.message || "Codex usage limits could not be read.")
  };
}

export async function refreshCodexProfileUsage(profileId) {
  const profile = findCodexProfile(profileId);
  const now = isoNow();
  try {
    const result = await callCodexAppServer(profile, [
      { id: 2, key: "rateLimitsResult", method: "account/rateLimits/read" },
      { id: 3, key: "usageResult", method: "account/usage/read", optional: true }
    ]);
    const snapshot = sanitizeUsageLimitSnapshot({
      status: "available",
      lastCheckedAt: now,
      rateLimits: result.rateLimitsResult?.rateLimits || null,
      rateLimitsByLimitId: result.rateLimitsResult?.rateLimitsByLimitId || {},
      rateLimitResetCredits: result.rateLimitsResult?.rateLimitResetCredits || null,
      usage: result.usageResult || null
    });
    return {
      usageLimit: snapshot,
      profiles: updateCodexProfile(profile.id, { usageLimit: snapshot })
    };
  } catch (error) {
    const snapshot = usageErrorSnapshot(error);
    return {
      usageLimit: snapshot,
      profiles: updateCodexProfile(profile.id, { usageLimit: snapshot })
    };
  }
}

export async function refreshAllCodexProfileUsage() {
  let profiles = listCodexProfiles();
  for (const profile of profiles) {
    if (!profile.enabled || profile.status !== "connected") continue;
    const result = await refreshCodexProfileUsage(profile.id);
    profiles = result.profiles;
  }
  return profiles;
}

export function classifyCodexError(text = "") {
  const value = String(text || "").toLowerCase();
  if (/rate.?limit|usage limit|quota|too many requests|429/.test(value)) return "usage_limit";
  if (/auth|login|unauthorized|forbidden|401|403/.test(value)) return "auth_failed";
  return "";
}

export const codexProfileTestHooks = {
  registryPath,
  validateCodexProfileId,
  normalizeAbsolutePath,
  codexProfilesRoot,
  resolveCodexProfileHome,
  classifyCodexError,
  getLoginSessionForTest: (loginSessionId) => loginSessions.get(loginSessionId)
};

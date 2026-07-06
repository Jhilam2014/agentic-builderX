function parseJwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function userFromRequest(req) {
  const userId = String(req.get("x-builderx-user-id") || req.query?.userId || "").trim();
  const userName = String(req.get("x-builderx-user-name") || req.query?.userName || "").trim();
  const userEmail = String(req.get("x-builderx-user-email") || req.query?.userEmail || "").trim();
  if (!userId) return { id: "anonymous", name: "Local user", email: "", authProvider: "local" };
  return {
    id: userId.slice(0, 160),
    name: userName.slice(0, 120) || "BuilderX user",
    email: userEmail.slice(0, 160),
    authProvider: "google"
  };
}

export function authenticateGooglePayload(body = {}) {
  const payload = parseJwtPayload(body.credential);
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  if (payload?.aud && clientId && payload.aud !== clientId) {
    throw new Error("Google credential audience does not match this BuilderX app.");
  }
  const profile = payload || body.profile || {};
  const id = profile.sub || body.googleUserId || body.userId;
  if (!id) throw new Error("Google user id is required.");
  return {
    id: `google:${String(id).slice(0, 120)}`,
    name: profile.name || body.name || "Google user",
    email: profile.email || body.email || "",
    picture: profile.picture || body.picture || "",
    authProvider: payload ? "google-id-token" : "google-dev-profile"
  };
}

export function restrictedIntent(text) {
  const value = String(text || "").toLowerCase();
  const rules = [
    {
      pattern: /(tech|architecture|source|code|implementation|system prompt|internal).{0,80}(agentic[- ]?builderx|builderx system|orchestrator)/i,
      reason: "Requests for internal Agentic BuilderX implementation details are restricted."
    },
    {
      pattern: /(clone|copy|same|exact|replica|duplicate).{0,80}(agentic[- ]?builderx|builderx app|this app)/i,
      reason: "Creating an exact copy of Agentic BuilderX is restricted."
    },
    {
      pattern: /(agent_knowledge_global|global vector|vectordb|vector db|vector store).{0,80}(pull|dump|export|extract|list|download|read|copy)/i,
      reason: "Direct extraction of global agent knowledge/vector memory is restricted."
    }
  ];
  return rules.find((rule) => rule.pattern.test(value)) || null;
}

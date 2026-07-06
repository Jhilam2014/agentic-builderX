const STORAGE_KEY = "builderx-user";

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function storeUser(user) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  window.dispatchEvent(new CustomEvent("builderx-user-updated", { detail: user }));
}

export function clearUser() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("builderx-user-updated", { detail: null }));
}

export function authHeaders(user = getStoredUser()) {
  if (!user?.id) return {};
  return {
    "x-builderx-user-id": user.id,
    "x-builderx-user-name": user.name || "",
    "x-builderx-user-email": user.email || ""
  };
}

export function authFetch(pathOrUrl, options = {}) {
  const headers = {
    ...authHeaders(),
    ...(options.headers || {})
  };
  return fetch(pathOrUrl, { ...options, headers });
}

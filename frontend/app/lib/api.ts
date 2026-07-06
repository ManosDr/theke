export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Same key auth.tsx stores the session under - duplicated here (not
// imported) since api.ts must stay framework-agnostic and can't depend on
// the React auth context; both sides agreeing on the literal is enough.
const AUTH_STORAGE_KEY = "theke-auth";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) ?? {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  // Only treat this as a session expiry if the call actually carried a
  // token - a 401 from e.g. /auth/login (wrong password, no token yet)
  // is a normal auth failure the caller already handles and displays;
  // conflating the two would show "session expired" instead of "wrong
  // password" on the login form itself.
  if (res.status === 401 && token) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    if (typeof window !== "undefined") {
      window.location.href = "/login?sessionExpired=1";
    }
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      // response wasn't JSON - keep statusText
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, token?: string | null) => request<T>(path, { method: "GET" }, token),
  post: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }, token),
  patch: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }, token),
  del: <T>(path: string, token?: string | null) => request<T>(path, { method: "DELETE" }, token),
  upload: <T>(path: string, formData: FormData, token?: string | null) =>
    request<T>(path, { method: "POST", body: formData }, token),
};

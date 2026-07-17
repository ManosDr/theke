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
      if (typeof data.detail === "string") {
        detail = data.detail;
      } else if (data.detail && typeof data.detail.message === "string") {
        // FastAPI's HTTPException(detail={...}) shape (e.g. auth.py's
        // vertical_slug validation, which also carries valid_slugs for
        // debugging) - surface the human-readable message, not raw JSON.
        detail = data.detail.message;
      } else {
        detail = JSON.stringify(data.detail);
      }
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
  // Triggers a browser download for a non-JSON response (data export,
  // invoice PDF) - can't reuse request() above since that always calls
  // res.json(). Auth still goes through the Authorization header (not a
  // query-string token), so a plain <a href> can't be used for either of
  // these endpoints - both serve data that needs a real access check.
  download: async (path: string, token: string | null, filename: string): Promise<void> => {
    const res = await fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

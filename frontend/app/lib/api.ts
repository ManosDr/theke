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

// status 0 marks a request that never got a response at all - the request
// timed out (AbortController below) or the browser's fetch() itself threw
// (offline, DNS failure, connection dropped mid-flight) - as opposed to a
// real HTTP error status from the backend. Callers check for this to show
// a "no connection" message instead of a generic/backend one - see
// chat/page.tsx's sendMessage and ProjectDocumentsPanel's handleUpload,
// both real-world "used on a job site, spotty signal" scenarios.
export const NETWORK_ERROR_STATUS = 0;

// Lets auth.tsx keep its in-memory user.token in sync whenever this module
// silently mints a new one via refreshAccessToken() below - api.ts stays
// framework-agnostic (no React import), so it exposes a plain setter instead
// of depending on the auth context directly.
let onTokenRefreshed: ((token: string) => void) | null = null;

export function setOnTokenRefreshed(cb: ((token: string) => void) | null) {
  onTokenRefreshed = cb;
}

// Dedupes concurrent 401s: several requests can fail with an expired access
// token in the same tick (e.g. a page firing off multiple GETs on load), and
// each of them independently exchanging the refresh cookie would race each
// other under rotation-on-use (see auth.py's /auth/refresh) - the second
// exchange would present an already-rotated-away token and fail. Sharing one
// in-flight promise means only the first caller actually hits the network;
// everyone else just awaits the same result.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
        if (!res.ok) return null;
        const data = (await res.json()) as { token: string };
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (raw) {
          try {
            const stored = JSON.parse(raw);
            stored.token = data.token;
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));
          } catch {
            // stored session wasn't valid JSON - nothing to patch
          }
        }
        onTokenRefreshed?.(data.token);
        return data.token;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

function sessionExpired(): never {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  if (typeof window !== "undefined") {
    window.location.href = "/login?sessionExpired=1";
  }
  throw new ApiError(401, "Session expired");
}

async function request<T>(
  path: string,
  options: RequestInit,
  token?: string | null,
  timeoutMs?: number
): Promise<T> {
  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) ?? {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const controller = timeoutMs ? new AbortController() : undefined;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include", signal: controller?.signal });
  } catch (err) {
    // AbortError (our own timeout) and a raw network failure (offline,
    // DNS, connection reset mid-request) both mean "no usable response
    // ever arrived" - same signal to the caller either way.
    throw new ApiError(NETWORK_ERROR_STATUS, err instanceof Error ? err.message : "Network error");
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  // Only treat this as a session expiry if the call actually carried a
  // token - a 401 from e.g. /auth/login (wrong password, no token yet)
  // is a normal auth failure the caller already handles and displays;
  // conflating the two would show "session expired" instead of "wrong
  // password" on the login form itself.
  if (res.status === 401 && token) {
    // The access token itself expiring is no longer a user-visible event -
    // silently exchange the httpOnly refresh cookie for a new one and retry
    // this exact request once (see auth.py's POST /auth/refresh). Only a
    // failure here (refresh token itself expired/revoked/missing) is a real
    // session expiry.
    const newToken = await refreshAccessToken();
    if (!newToken) sessionExpired();

    const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
    try {
      res = await fetch(`${API_URL}${path}`, { ...options, headers: retryHeaders, credentials: "include", signal: controller?.signal });
    } catch (err) {
      throw new ApiError(NETWORK_ERROR_STATUS, err instanceof Error ? err.message : "Network error");
    }
    if (res.status === 401) sessionExpired();
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
  post: <T>(path: string, body?: unknown, token?: string | null, timeoutMs?: number) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }, token, timeoutMs),
  patch: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }, token),
  del: <T>(path: string, token?: string | null) => request<T>(path, { method: "DELETE" }, token),
  upload: <T>(path: string, formData: FormData, token?: string | null, timeoutMs?: number) =>
    request<T>(path, { method: "POST", body: formData }, token, timeoutMs),
  // Triggers a browser download for a non-JSON response (data export,
  // invoice PDF) - can't reuse request() above since that always calls
  // res.json(). Auth still goes through the Authorization header (not a
  // query-string token), so a plain <a href> can't be used for either of
  // these endpoints - both serve data that needs a real access check.
  download: async (path: string, token: string | null, filename: string): Promise<void> => {
    const res = await fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
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

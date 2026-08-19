"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { API_URL, api, setOnTokenRefreshed } from "./api";

export type CompanyType = "construction" | "municipality" | "accounting";
export type Role = "super_admin" | "admin" | "member";

// Construction firms and municipalities both consume the "construction"
// vertical's content (see register/page.tsx's own comment on this same
// mapping) - only "accounting" maps to "tax_accounting". Shared here so the
// pricing page and TrialNudgeBanner's conversion nudge don't each re-derive it.
export function companyTypeToVerticalSlug(companyType: CompanyType | null): "construction" | "tax_accounting" {
  return companyType === "accounting" ? "tax_accounting" : "construction";
}

export interface AuthUser {
  token: string;
  companyId: number | null;
  companyType: CompanyType | null;
  role: Role;
  email: string;
  firstName: string | null;
  lastName: string | null;
  preferredLocale: string | null;
  preferredTheme: string | null;
  emailVerified: boolean;
}

interface TokenResponse {
  token: string;
  company_id: number | null;
  company_type: CompanyType | null;
  role: Role;
  first_name: string | null;
  last_name: string | null;
  preferred_locale: string | null;
  preferred_theme: string | null;
  email_verified: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updatePreferredLocale: (locale: string) => Promise<void>;
  updatePreferredTheme: (theme: string) => Promise<void>;
  markEmailVerified: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "theke-auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const stored = JSON.parse(raw) as AuthUser;
        // Sessions persisted before emailVerified existed have no such key
        // in localStorage - default true (matches the DB's own default for
        // every pre-existing account) rather than treating them as
        // suddenly unverified.
        if (stored.emailVerified === undefined) stored.emailVerified = true;
        setUser(stored);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  // api.ts silently exchanges the httpOnly refresh cookie for a new access
  // token whenever a request 401s (see request()'s interceptor) - this
  // keeps the in-memory user.token (and localStorage) in sync with that, so
  // the next call made from React state doesn't immediately 401 again on a
  // token api.ts already knows is stale. Registered/cleared every render
  // the provider mounts so it always closes over the current `user`.
  useEffect(() => {
    setOnTokenRefreshed((newToken) => {
      setUser((current) => (current ? { ...current, token: newToken } : current));
    });
    return () => setOnTokenRefreshed(null);
  }, []);

  async function login(email: string, password: string) {
    const data = await api.post<TokenResponse>("/auth/login", { email, password });
    const authUser: AuthUser = {
      token: data.token,
      companyId: data.company_id,
      companyType: data.company_type,
      role: data.role,
      email,
      firstName: data.first_name,
      lastName: data.last_name,
      preferredLocale: data.preferred_locale,
      preferredTheme: data.preferred_theme,
      emailVerified: data.email_verified,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    setUser(authUser);
  }

  function logout() {
    // Best-effort: revokes the refresh-token cookie server-side (see
    // auth.py's POST /auth/logout) so a leaked/replayed refresh token can't
    // mint new access tokens after this point. Not awaited - clearing local
    // state must not block on the network (e.g. logging out while offline
    // must still work). keepalive: true (not the api.ts wrapper's plain
    // fetch) so the request survives the client-side redirect to /login
    // that follows immediately below - confirmed via the dev DB that a
    // plain fetch here can still complete, but the browser's network panel
    // reports it as an aborted request once the page starts navigating
    // away; keepalive is the standard fix for a fire-and-forget request
    // that must outlive the triggering page transition.
    fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include", keepalive: true }).catch(() => {});
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }

  async function updatePreferredLocale(locale: string) {
    if (!user) return;
    await api.patch("/auth/me/locale", { locale }, user.token);
    const updated = { ...user, preferredLocale: locale };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setUser(updated);
  }

  async function updatePreferredTheme(theme: string) {
    if (!user) return;
    await api.patch("/auth/me/theme", { theme }, user.token);
    const updated = { ...user, preferredTheme: theme };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setUser(updated);
  }

  // Called by the /verify-email page after a successful POST /auth/verify-
  // email, purely local state - no extra API round-trip, since the backend
  // call that just succeeded already did the actual work.
  function markEmailVerified() {
    if (!user) return;
    const updated = { ...user, emailVerified: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setUser(updated);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        updatePreferredLocale,
        updatePreferredTheme,
        markEmailVerified,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  return <>{children}</>;
}

// Mirrors the backend's require_super_admin check (app/services/
// authorization.py) - a non-super_admin is redirected away rather than
// shown the page and denied API calls one by one.
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || user.role !== "super_admin")) {
      router.replace(user ? "/dashboard" : "/login");
    }
  }, [loading, user, router]);

  if (loading || !user || user.role !== "super_admin") {
    return (
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  return <>{children}</>;
}

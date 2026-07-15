"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { api } from "./api";

// 2 minutes before the JWT's own exp claim - gives the user a chance to
// save work and re-login in a new tab before the hard 401 redirect (see
// api.ts's request()) kicks in and drops whatever they were doing.
const EXPIRY_WARNING_LEAD_MS = 120_000;

// JWTs are three base64url segments; the payload (middle segment) carries
// the standard "exp" claim in seconds since epoch. No verification needed
// here - this is just reading a value the frontend already trusts (the
// token came from our own login response), not authenticating anything.
function decodeJwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    const decoded = JSON.parse(json);
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

export type CompanyType = "construction" | "municipality" | "accounting";
export type Role = "super_admin" | "admin" | "member";

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
}

interface ImpersonateResponse extends TokenResponse {
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updatePreferredLocale: (locale: string) => Promise<void>;
  updatePreferredTheme: (theme: string) => Promise<void>;
  showSessionExpiryWarning: boolean;
  dismissSessionExpiryWarning: () => void;
  // Lets a super admin view the app as another user without their
  // password (see backend POST /admin/users/{id}/impersonate) - the
  // soft-launch replacement for the old public demo-account picker, now
  // gated behind an already-authenticated super admin instead of open to
  // any visitor. `impersonating` reflects whether the original super
  // admin session is currently stashed, so the UI can offer a way back.
  impersonating: boolean;
  impersonateAsUser: (userId: number) => Promise<void>;
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "theke-auth";
const ORIGINAL_STORAGE_KEY = "theke-auth-original";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSessionExpiryWarning, setShowSessionExpiryWarning] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleExpiryWarning(token: string) {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    setShowSessionExpiryWarning(false);
    const expiresAtMs = decodeJwtExpMs(token);
    if (!expiresAtMs) return;
    const msUntilWarning = expiresAtMs - Date.now() - EXPIRY_WARNING_LEAD_MS;
    if (msUntilWarning <= 0) return; // already inside the warning window (e.g. a stale page reload) - the 401 handler is the fallback
    expiryTimerRef.current = setTimeout(() => setShowSessionExpiryWarning(true), msUntilWarning);
  }

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const stored = JSON.parse(raw) as AuthUser;
        setUser(stored);
        scheduleExpiryWarning(stored.token);
        setImpersonating(localStorage.getItem(ORIGINAL_STORAGE_KEY) !== null);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    };
    localStorage.removeItem(ORIGINAL_STORAGE_KEY);
    setImpersonating(false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    setUser(authUser);
    scheduleExpiryWarning(authUser.token);
  }

  function logout() {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    setShowSessionExpiryWarning(false);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ORIGINAL_STORAGE_KEY);
    setImpersonating(false);
    setUser(null);
  }

  async function impersonateAsUser(userId: number) {
    if (!user) return;
    const data = await api.post<ImpersonateResponse>(`/admin/users/${userId}/impersonate`, undefined, user.token);
    // Only stash once - impersonating a second user while already
    // impersonating should still be able to return to the *original*
    // super admin, not to the first impersonated user.
    if (!localStorage.getItem(ORIGINAL_STORAGE_KEY)) {
      localStorage.setItem(ORIGINAL_STORAGE_KEY, JSON.stringify(user));
    }
    const authUser: AuthUser = {
      token: data.token,
      companyId: data.company_id,
      companyType: data.company_type,
      role: data.role,
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      preferredLocale: data.preferred_locale,
      preferredTheme: data.preferred_theme,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    setUser(authUser);
    setImpersonating(true);
    scheduleExpiryWarning(authUser.token);
  }

  function stopImpersonating() {
    const raw = localStorage.getItem(ORIGINAL_STORAGE_KEY);
    if (!raw) return;
    try {
      const original = JSON.parse(raw) as AuthUser;
      localStorage.removeItem(ORIGINAL_STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(original));
      setUser(original);
      setImpersonating(false);
      scheduleExpiryWarning(original.token);
    } catch {
      localStorage.removeItem(ORIGINAL_STORAGE_KEY);
      setImpersonating(false);
    }
  }

  function dismissSessionExpiryWarning() {
    setShowSessionExpiryWarning(false);
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

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        updatePreferredLocale,
        updatePreferredTheme,
        showSessionExpiryWarning,
        dismissSessionExpiryWarning,
        impersonating,
        impersonateAsUser,
        stopImpersonating,
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

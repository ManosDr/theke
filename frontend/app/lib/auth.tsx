"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { api } from "./api";

export type CompanyType = "construction" | "municipality" | "accounting";
export type Role = "super_admin" | "admin" | "member";

export interface AuthUser {
  token: string;
  companyId: number | null;
  companyType: CompanyType | null;
  role: Role;
  email: string;
  preferredLocale: string | null;
  preferredTheme: string | null;
}

interface TokenResponse {
  token: string;
  company_id: number | null;
  company_type: CompanyType | null;
  role: Role;
  preferred_locale: string | null;
  preferred_theme: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updatePreferredLocale: (locale: string) => Promise<void>;
  updatePreferredTheme: (theme: string) => Promise<void>;
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
        setUser(JSON.parse(raw));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const data = await api.post<TokenResponse>("/auth/login", { email, password });
    const authUser: AuthUser = {
      token: data.token,
      companyId: data.company_id,
      companyType: data.company_type,
      role: data.role,
      email,
      preferredLocale: data.preferred_locale,
      preferredTheme: data.preferred_theme,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    setUser(authUser);
  }

  function logout() {
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

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updatePreferredLocale, updatePreferredTheme }}>
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

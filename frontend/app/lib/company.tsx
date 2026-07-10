"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "./api";
import { useAuth } from "./auth";
import type { MyCompanySummary } from "./types";

interface CompanyContextValue {
  company: MyCompanySummary | null;
  refresh: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [company, setCompany] = useState<MyCompanySummary | null>(null);

  const refresh = useCallback(async () => {
    // super_admin has no company_id - /companies/me would 404 for them, so
    // don't even attempt the call rather than swallowing an expected error.
    if (!user?.token || !user.companyId) {
      setCompany(null);
      return;
    }
    const data = await api.get<MyCompanySummary>("/companies/me", user.token);
    setCompany(data);
  }, [user?.token, user?.companyId]);

  useEffect(() => {
    refresh().catch(() => setCompany(null));
  }, [refresh]);

  return <CompanyContext.Provider value={{ company, refresh }}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}

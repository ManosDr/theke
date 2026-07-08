"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// 'construction' | 'tax_accounting' | 'all' - the global filter driving the
// super-admin screens (dashboard/documents/sources/companies/verticals).
// Regular company users never see this switcher (their company already
// belongs to exactly one vertical), so this context is only consumed by
// super-admin pages, but is provided globally for simplicity.
export type SelectedVertical = "construction" | "tax_accounting" | "all";

interface VerticalContextValue {
  selectedVertical: SelectedVertical;
  setSelectedVertical: (v: SelectedVertical) => void;
}

const VerticalContext = createContext<VerticalContextValue | null>(null);
const STORAGE_KEY = "theke_vertical";

export function VerticalProvider({ children }: { children: ReactNode }) {
  const [selectedVertical, setSelectedVerticalState] = useState<SelectedVertical>("all");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "construction" || stored === "tax_accounting" || stored === "all") {
      setSelectedVerticalState(stored);
    }
  }, []);

  function setSelectedVertical(v: SelectedVertical) {
    setSelectedVerticalState(v);
    localStorage.setItem(STORAGE_KEY, v);
  }

  return (
    <VerticalContext.Provider value={{ selectedVertical, setSelectedVertical }}>{children}</VerticalContext.Provider>
  );
}

export function useVertical() {
  const ctx = useContext(VerticalContext);
  if (!ctx) throw new Error("useVertical must be used within VerticalProvider");
  return ctx;
}

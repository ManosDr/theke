"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "./api";
import { useAuth } from "./auth";
import { translations, type TranslationKey } from "./translations";

export interface LocaleOption {
  code: string;
  name: string;
  is_builtin: boolean;
}

interface LocaleContextValue {
  locale: string;
  locales: LocaleOption[];
  setLocale: (locale: string) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  refreshLocales: () => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);
const STORAGE_KEY = "theke-locale";

// Bundled fallback so the language dropdown and every t() call work even
// before /locales has answered (or if the backend is unreachable).
const BUILTIN_LOCALES: LocaleOption[] = [
  { code: "en", name: "English", is_builtin: true },
  { code: "el", name: "Ελληνικά", is_builtin: true },
];

const BUILTIN_TRANSLATIONS = translations as Record<string, Partial<Record<TranslationKey, string>>>;

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user, updatePreferredLocale } = useAuth();
  const [locale, setLocaleState] = useState<string>("en");
  const [locales, setLocales] = useState<LocaleOption[]>(BUILTIN_LOCALES);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    // A signed-in user's saved preference wins; otherwise fall back to
    // whatever was last picked on this device (or the built-in default).
    if (user?.preferredLocale) {
      setLocaleState(user.preferredLocale);
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setLocaleState(stored);
  }, [user?.preferredLocale]);

  async function refreshLocales() {
    try {
      const data = await api.get<LocaleOption[]>("/locales");
      setLocales(data);
    } catch {
      // backend unreachable - keep the bundled en/el list
    }
  }

  useEffect(() => {
    refreshLocales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api
      .get<Record<string, string>>(`/translations/${locale}`)
      .then(setOverrides)
      .catch(() => setOverrides({}));
  }, [locale]);

  function setLocale(next: string) {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    if (user) updatePreferredLocale(next).catch(() => {});
  }

  function t(key: TranslationKey, params?: Record<string, string | number>): string {
    let str: string = overrides[key] ?? BUILTIN_TRANSLATIONS[locale]?.[key] ?? translations.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`{{${k}}}`, "g"), String(v));
      }
    }
    return str;
  }

  return (
    <LocaleContext.Provider value={{ locale, locales, setLocale, t, refreshLocales }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

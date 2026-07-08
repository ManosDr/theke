"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// 80-140% in 10-point steps, matching the design handoff's A-/A+ control.
// The prototype implements this via CSS `zoom` on a wrapper div - its own
// README flags that as "a pragmatic prototype shortcut (Chromium/WebKit
// only)" and asks for a proper root font-size/rem-based implementation in
// production, which is what this does instead (works in Firefox too, and
// respects the cascade the same way a user's own browser zoom would).
const MIN_SCALE = 80;
const MAX_SCALE = 140;
const STEP = 10;
const DEFAULT_SCALE = 100;

interface FontScaleContextValue {
  scale: number;
  increase: () => void;
  decrease: () => void;
}

const FontScaleContext = createContext<FontScaleContextValue | null>(null);
const STORAGE_KEY = "theke_font_scale";

export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(DEFAULT_SCALE);

  useEffect(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (stored >= MIN_SCALE && stored <= MAX_SCALE) setScale(stored);
  }, []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${scale}%`;
    localStorage.setItem(STORAGE_KEY, String(scale));
  }, [scale]);

  function increase() {
    setScale((s) => Math.min(MAX_SCALE, s + STEP));
  }

  function decrease() {
    setScale((s) => Math.max(MIN_SCALE, s - STEP));
  }

  return <FontScaleContext.Provider value={{ scale, increase, decrease }}>{children}</FontScaleContext.Provider>;
}

export function useFontScale() {
  const ctx = useContext(FontScaleContext);
  if (!ctx) throw new Error("useFontScale must be used within FontScaleProvider");
  return ctx;
}

"use client";

import { useEffect } from "react";

import { useTheme } from "../lib/theme";

// layout.tsx's metadata declares two favicon <link>s keyed to
// prefers-color-scheme (the OS setting), but lib/theme.tsx's in-app toggle
// deliberately ignores prefers-color-scheme and tracks its own light/dark
// state via data-theme (localStorage or the user's saved preference). The
// two were never connected, so switching the in-app theme left the browser
// tab favicon on whatever the OS preferred - this replaces the static
// media-query links with a single one that follows data-theme instead.
export function FaviconSync() {
  const { theme } = useTheme();

  useEffect(() => {
    document.querySelectorAll('link[rel="icon"][media]').forEach((el) => el.remove());

    const href = theme === "dark" ? "/icons/icon-dark-theme.svg" : "/icons/icon.svg";
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]:not([media])');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [theme]);

  return null;
}

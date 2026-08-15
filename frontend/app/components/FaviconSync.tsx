"use client";

import { useEffect } from "react";

import { useTheme } from "../lib/theme";

// layout.tsx's metadata renders a static favicon <link> (the light mark,
// matching the app's own light-by-default philosophy - see lib/theme.tsx),
// but lib/theme.tsx's in-app toggle can switch to dark and that static link
// never followed it. This appends a second <link> of its own to override it
// when needed, and only ever touches that one node - it must never remove
// or otherwise mutate the link Next's metadata system rendered, because
// Next's own head reconciliation still holds a reference to it and later
// tries to update/remove it itself on client-side navigation; deleting it
// out from under Next crashes the whole app with "Cannot read properties of
// null (reading 'removeChild')" the next time that reconciliation runs.
const OWNED_ICON_ID = "theke-favicon-sync";

export function FaviconSync() {
  const { theme } = useTheme();

  useEffect(() => {
    if (theme !== "dark") return;

    let link = document.getElementById(OWNED_ICON_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = OWNED_ICON_ID;
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }
    link.href = "/icons/icon-dark-theme.svg";

    return () => {
      link?.remove();
    };
  }, [theme]);

  return null;
}

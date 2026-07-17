"use client";

import { AppShell } from "./AppShell";
import { LanguageToggle } from "./LanguageToggle";
import { LegalDocView } from "./LegalDocView";
import { LegalFooter } from "./LegalFooter";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { useAuth } from "../lib/auth";
import type { LegalDocSlug } from "../lib/types";
import styles from "./LegalPageShell.module.css";

// Reachable both logged-out (public, standalone header + footer) and
// logged-in (wrapped in the app shell, no footer - Account page's own
// "Νομικά" section covers those links there instead) - same dual-mode
// pattern as /pricing.
export function LegalPageShell({ slug }: { slug: LegalDocSlug }) {
  const { user } = useAuth();

  if (user) {
    return (
      <AppShell>
        <div className={styles.wrap}>
          <LegalDocView slug={slug} />
        </div>
      </AppShell>
    );
  }

  return (
    <main className={styles.publicPage}>
      <div className={styles.publicHeader}>
        <Logo size={36} />
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
      <div className={styles.wrap}>
        <LegalDocView slug={slug} />
      </div>
      <LegalFooter />
    </main>
  );
}

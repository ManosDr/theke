"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import styles from "./AppShell.module.css";
import { LanguageToggle } from "./LanguageToggle";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/dashboard" style={{ textDecoration: "none", color: "inherit" }}>
          <Logo size={32} />
        </Link>

        <nav className={styles.nav}>
          <Link
            href="/dashboard"
            className={`${styles.navLink} ${pathname === "/dashboard" ? styles.navLinkActive : ""}`}
          >
            {t("nav.dashboard")}
          </Link>
          <Link href="/sources" className={`${styles.navLink} ${pathname?.startsWith("/sources") ? styles.navLinkActive : ""}`}>
            {t("nav.sources")}
          </Link>
          <Link href="/search" className={`${styles.navLink} ${pathname === "/search" ? styles.navLinkActive : ""}`}>
            {t("nav.search")}
          </Link>
          <Link href="/chat" className={`${styles.navLink} ${pathname === "/chat" ? styles.navLinkActive : ""}`}>
            {t("nav.chat")}
          </Link>
        </nav>

        <div className={styles.userMenu}>
          <LanguageToggle />
          <ThemeToggle />
          {user && (
            <div className={styles.userInfo}>
              <span className={styles.userEmail}>{user.email}</span>
              <span className="text-muted">{t(`role.${user.role}` as TranslationKey)}</span>
            </div>
          )}
          <button className="btn btn-secondary" onClick={handleLogout}>
            {t("nav.signOut")}
          </button>
        </div>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}

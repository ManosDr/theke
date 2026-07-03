"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import styles from "./AppShell.module.css";
import { LanguageToggle } from "./LanguageToggle";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function handleLogout() {
    setOpen(false);
    logout();
    router.push("/login");
  }

  if (!user) return null;

  return (
    <div className={styles.userMenu} ref={menuRef}>
      <button
        className={styles.userMenuTrigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={styles.userInfo}>
          <span className={styles.userEmail}>{user.email}</span>
          <span className={`text-muted ${styles.userRole}`}>{t(`role.${user.role}` as TranslationKey)}</span>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.dropdown} role="menu">
          <div className={styles.dropdownItem} role="menuitem">
            <span>{t("nav.language")}</span>
            <LanguageToggle />
          </div>
          <div className={styles.dropdownItem} role="menuitem">
            <span>{t("nav.theme")}</span>
            <ThemeToggle />
          </div>
          <button className={`${styles.dropdownItem} ${styles.dropdownButton}`} role="menuitem" onClick={handleLogout}>
            {t("nav.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const pathname = usePathname();

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

        <UserMenu />
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}

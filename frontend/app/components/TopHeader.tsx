"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "../lib/auth";
import { useFontScale } from "../lib/fontScale";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { useTheme } from "../lib/theme";
import { NotificationBell } from "./NotificationBell";
import { MoonIcon, SunIcon } from "./StatIcons";
import styles from "./TopHeader.module.css";

function pageTitleKey(pathname: string): TranslationKey {
  if (pathname === "/admin/documents") return "nav.documents";
  if (pathname === "/admin/data-sources") return "nav.dataSources";
  if (pathname === "/admin/companies") return "nav.companies";
  if (pathname === "/admin/verticals") return "nav.verticalsContent";
  if (pathname.startsWith("/sources") || pathname.startsWith("/documents")) return "nav.sources";
  if (pathname === "/search") return "nav.search";
  if (pathname === "/chat") return "nav.chat";
  return "nav.dashboard";
}

// Breadcrumb strings per the Theke Admin design handoff's own `breadcrumbs`
// map (Theke Admin.dc.html) for admin routes; the tenant-facing pages
// (Sources/Search/Chat) aren't part of that design at all, so they get a
// plain "Αρχική / <page>" trail in the same style rather than nothing.
const BREADCRUMB_KEYS: Record<string, TranslationKey> = {
  "/dashboard": "breadcrumb.dashboard",
  "/sources": "breadcrumb.sources",
  "/search": "breadcrumb.search",
  "/chat": "breadcrumb.chat",
  "/admin/documents": "breadcrumb.documents",
  "/admin/data-sources": "breadcrumb.dataSources",
  "/admin/companies": "breadcrumb.companies",
  "/admin/verticals": "breadcrumb.verticals",
};

function LanguageSelect() {
  const { locale, locales, setLocale, t } = useLocale();
  return (
    <div className={styles.selectWrap}>
      <select
        className={styles.languageSelect}
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label={t("topbar.language")}
      >
        {locales.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      <svg
        className={styles.selectChevron}
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
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

  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <div className={styles.userMenuWrap} ref={wrapperRef}>
      <button
        type="button"
        className={styles.avatar}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("sidebar.myAccount")}
        onClick={() => setOpen((o) => !o)}
      >
        {initial}
      </button>

      {open && (
        <div className={styles.userMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.userMenuItem}
            onClick={() => {
              setOpen(false);
              router.push("/account");
            }}
          >
            {t("sidebar.myAccount")}
          </button>
          <div className={styles.userMenuDivider} />
          <button
            type="button"
            role="menuitem"
            className={styles.userMenuItem}
            onClick={() => {
              setOpen(false);
              logout();
              router.push("/login");
            }}
          >
            {t("nav.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}

export function TopHeader() {
  const { t } = useLocale();
  const { theme, setTheme } = useTheme();
  const { scale, increase, decrease } = useFontScale();
  const pathname = usePathname() ?? "/dashboard";

  const breadcrumbKey = BREADCRUMB_KEYS[pathname];

  return (
    <header className={styles.header}>
      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{t(pageTitleKey(pathname))}</h1>
        {breadcrumbKey && <span className={styles.breadcrumb}>{t(breadcrumbKey)}</span>}
      </div>

      <div className={styles.actions}>
        <div className={styles.fontScaleGroup}>
          <button type="button" className={styles.fontScaleButton} title={t("topbar.decreaseFont")} onClick={decrease}>
            A-
          </button>
          <span className={styles.fontScalePct}>{scale}%</span>
          <button
            type="button"
            className={`${styles.fontScaleButton} ${styles.fontScaleButtonBig}`}
            title={t("topbar.increaseFont")}
            onClick={increase}
          >
            A+
          </button>
        </div>

        <LanguageSelect />

        <button
          type="button"
          className={styles.iconPill}
          title={t("topbar.toggleTheme")}
          aria-label={t("topbar.toggleTheme")}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>

        <NotificationBell />

        <UserMenu />
      </div>
    </header>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useFontScale } from "../lib/fontScale";
import { useLocale } from "../lib/i18n";
import type { SubscriptionStatusResponse } from "../lib/types";
import type { TranslationKey } from "../lib/translations";
import { useTheme } from "../lib/theme";
import { getInitials } from "../lib/userDisplay";
import { LanguageToggle } from "./LanguageToggle";
import { NotificationBell } from "./NotificationBell";
import { MoonIcon, SunIcon } from "./StatIcons";
import styles from "./TopHeader.module.css";

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

// Always visible while on trial (unlike TrialBanner, which only appears in
// the final 14 days) - a persistent, low-key reminder of how much beta time
// is left, per item 19 of the batch-1 fix list. super_admin has no
// company_id, so this fetches nothing and renders nothing for that role,
// same as TrialBanner.
function TrialBadge() {
  const { user } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState<SubscriptionStatusResponse | null>(null);

  const eligible = !!user && user.role !== "super_admin" && user.companyId != null;

  useEffect(() => {
    if (!eligible || !user) return;
    api
      .get<SubscriptionStatusResponse>("/subscription/status", user.token)
      .then(setStatus)
      .catch(() => setStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, user?.token]);

  if (!status || status.status !== "trial" || !status.trial_ends_at) return null;

  const days = daysUntil(status.trial_ends_at);
  if (days < 0) return null;

  return (
    <button
      type="button"
      className={styles.trialBadge}
      onClick={() => router.push(user!.role === "admin" ? "/dashboard?tab=subscription" : "/account")}
      title={t("trialBanner.badgeTooltip")}
    >
      {t("trialBanner.badgeLabel", { days: days <= 1 ? t("trialBanner.oneDay") : t("trialBanner.days", { days }) })}
    </button>
  );
}

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

export function UserMenu() {
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

  const initials = getInitials(user?.firstName, user?.lastName, user?.email);

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
        {initials}
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
        <TrialBadge />

        {/* Preference controls, not navigation or account-critical actions -
            hidden below 640px (see .desktopOnlyActions) in favor of the
            same three controls living in the Sidebar drawer's settings
            section, which is what a phone-width top bar has room for.
            Layout-level (this header is shared by every page except Chat's
            own compact mobile header), not a Chat-specific treatment. */}
        <div className={styles.desktopOnlyActions}>
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

          <LanguageToggle />

          <button
            type="button"
            className={styles.iconPill}
            title={t("topbar.toggleTheme")}
            aria-label={t("topbar.toggleTheme")}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
        </div>

        <NotificationBell />

        <UserMenu />
      </div>
    </header>
  );
}

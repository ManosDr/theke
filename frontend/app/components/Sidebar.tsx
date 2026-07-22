"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { API_URL } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCompany } from "../lib/company";
import { useFontScale } from "../lib/fontScale";
import { useLocale } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { getInitials } from "../lib/userDisplay";
import { useVertical, type SelectedVertical } from "../lib/vertical";
import { LanguageToggle } from "./LanguageToggle";
import { LogoMark } from "./Logo";
import {
  BillingIcon,
  ChatIcon,
  CompaniesIcon,
  HelpIcon,
  MenuIcon,
  NavDashboardIcon,
  NavKnowledgeBaseIcon,
  SearchIcon,
  SettingsIcon,
  SourcesIcon,
} from "./NavIcons";
import { LogoutIcon, MoonIcon, SunIcon } from "./StatIcons";
import { CloseIcon } from "./UiIcons";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/dashboard", labelKey: "nav.dashboard", Icon: NavDashboardIcon, match: (p: string) => p === "/dashboard" },
  { href: "/sources", labelKey: "nav.sources", Icon: SourcesIcon, match: (p: string) => p.startsWith("/sources") || p.startsWith("/documents") },
  { href: "/search", labelKey: "nav.search", Icon: SearchIcon, match: (p: string) => p === "/search" },
  { href: "/chat", labelKey: "nav.chat", Icon: ChatIcon, match: (p: string) => p === "/chat" },
  // Filtered out for super_admin below (no company to subscribe for - they
  // manage plans via the existing Admin > Εταιρείες & Χρήστες > Συνδρομές >
  // Πλάνα path instead, see ADMIN_SECTIONS' "org" section).
  { href: "/pricing", labelKey: "nav.pricing", Icon: BillingIcon, match: (p: string) => p === "/pricing" },
] as const;

// Nav tree per the Theke Admin design handoff's own sidebar structure
// (Theke Admin.dc.html). "Χρήστες"/"Προσκλήσεις" now route to their own
// screens (GET /admin/users, /admin/invites - see AdminUsersPanel/
// AdminInvitesPanel), matching the company-level Χρήστες tab's pattern.
// "Γενικές Ρυθμίσεις" still has no spec of its own (see KNOWN_DECISIONS.md)
// and stays pointed at Verticals as a placeholder.
const ADMIN_SECTIONS = [
  {
    key: "kb",
    labelKey: "nav.knowledgeBase",
    Icon: NavKnowledgeBaseIcon,
    match: (p: string) => p === "/admin/documents" || p === "/admin/data-sources" || p === "/admin/feedback",
    children: [
      { href: "/admin/documents", labelKey: "nav.documents", match: (p: string) => p === "/admin/documents" },
      { href: "/admin/data-sources", labelKey: "nav.dataSources", match: (p: string) => p === "/admin/data-sources" },
      { href: "/admin/feedback", labelKey: "nav.feedback", match: (p: string) => p === "/admin/feedback" },
    ],
  },
  {
    key: "org",
    labelKey: "nav.companiesUsers",
    Icon: CompaniesIcon,
    match: (p: string) =>
      p === "/admin/companies" || p === "/admin/users" || p === "/admin/invites" || p === "/admin/subscriptions",
    children: [
      { href: "/admin/companies", labelKey: "nav.companies", match: (p: string) => p === "/admin/companies" },
      { href: "/admin/users", labelKey: "nav.users", match: (p: string) => p === "/admin/users" },
      { href: "/admin/invites", labelKey: "nav.invites", match: (p: string) => p === "/admin/invites" },
      { href: "/admin/subscriptions", labelKey: "nav.subscriptions", match: (p: string) => p === "/admin/subscriptions" },
    ],
  },
  {
    key: "settings",
    labelKey: "nav.systemSettings",
    Icon: SettingsIcon,
    match: (p: string) => p === "/admin/verticals" || p === "/admin/regions",
    children: [
      { href: "/admin/verticals", labelKey: "nav.verticalsContent", match: (p: string) => p === "/admin/verticals" },
      { href: "/admin/verticals", labelKey: "nav.generalSettings", match: () => false },
      { href: "/admin/regions", labelKey: "nav.regionsProviders", match: (p: string) => p === "/admin/regions" },
    ],
  },
] as const;

const VERTICAL_OPTIONS: { value: SelectedVertical; labelKey: "vertical.construction" | "vertical.tax_accounting" | "vertical.all" }[] = [
  { value: "construction", labelKey: "vertical.construction" },
  { value: "tax_accounting", labelKey: "vertical.tax_accounting" },
  { value: "all", labelKey: "vertical.all" },
];

const ACCENT_VAR: Record<SelectedVertical, string> = {
  construction: "var(--admin-construction)",
  tax_accounting: "var(--admin-tax)",
  all: "var(--admin-accent-navy)",
};

const COLLAPSE_STORAGE_KEY = "theke_sidebar_collapsed";

function VerticalSwitcher({ collapsed }: { collapsed: boolean }) {
  const { selectedVertical, setSelectedVertical } = useVertical();
  const { t, tUpper } = useLocale();

  return (
    <div className={styles.switcherBlock}>
      {!collapsed && <div className={styles.switcherLabel}>{tUpper("docs.filterVertical")}</div>}
      <div className={collapsed ? styles.switcherDots : styles.switcherStack}>
        {VERTICAL_OPTIONS.map((opt) => {
          const active = selectedVertical === opt.value;
          const accent = ACCENT_VAR[opt.value];
          if (collapsed) {
            return (
              <button
                key={opt.value}
                type="button"
                title={t(opt.labelKey)}
                className={styles.switcherDot}
                style={{ borderColor: active ? accent : "var(--admin-card-border)", background: active ? accent : "transparent" }}
                onClick={() => setSelectedVertical(opt.value)}
              />
            );
          }
          return (
            <button
              key={opt.value}
              type="button"
              className={styles.switcherSegment}
              style={{ background: active ? accent : "transparent", color: active ? "#fff" : "var(--admin-text-body)" }}
              onClick={() => setSelectedVertical(opt.value)}
            >
              <span className={styles.switcherDotInline} style={{ background: active ? "#fff" : accent }} />
              <span>{t(opt.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CompanyBranding({ collapsed }: { collapsed: boolean }) {
  const { company } = useCompany();

  if (collapsed || !company?.has_logo || !company.logo_url) return null;

  return (
    <div className={styles.brandingBlock}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${API_URL}${company.logo_url}`} alt={company.name} className={styles.brandingLogo} />
      <h3 className={styles.brandingName}>{company.name}</h3>
    </div>
  );
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const { theme, setTheme } = useTheme();
  const { scale, increase, decrease } = useFontScale();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState<Record<string, boolean>>({ kb: true, org: false, settings: false });
  // Below 768px the sidebar becomes an off-canvas drawer instead of the
  // desktop expand/collapse toggle above - `collapsed` stays irrelevant
  // there (CSS forces full width whenever the drawer is open).
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
  }, []);

  // Auto-close the drawer on navigation - a drawer that stays open after
  // the user has already tapped through to the next screen just blocks it.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  }

  const isSuperAdmin = user?.role === "super_admin";

  function handleSectionClick(section: (typeof ADMIN_SECTIONS)[number]) {
    if (collapsed) {
      router.push(section.children[0].href);
      return;
    }
    setNavOpen((prev) => ({ ...prev, [section.key]: !prev[section.key] }));
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const fullName = user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "";
  const initials = getInitials(user?.firstName, user?.lastName, user?.email);

  return (
    <>
      {/* Rendered only while closed - once the drawer is open, its own
          close (X) button is the way to dismiss it, so showing both at once
          just duplicates the control and risks overlapping the open panel. */}
      {!mobileOpen && (
        <button
          type="button"
          className={styles.mobileMenuTrigger}
          onClick={() => setMobileOpen(true)}
          aria-label={t("sidebar.openMenu")}
          aria-expanded={mobileOpen}
        >
          <MenuIcon size={22} />
        </button>
      )}
      {mobileOpen && (
        <div className={styles.mobileBackdrop} onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""} ${mobileOpen ? styles.sidebarMobileOpen : ""}`}
      >
        <div className={styles.wordmarkRow}>
          {collapsed ? (
            <LogoMark size={24} />
          ) : (
            <div>
              <div className={styles.wordmarkText}>theke</div>
            </div>
          )}
          <button
            type="button"
            className={styles.mobileCloseButton}
            onClick={() => setMobileOpen(false)}
            aria-label={t("sidebar.closeMenu")}
          >
            <CloseIcon size={18} />
          </button>
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={toggleCollapsed}
            title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
            aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          >
            <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
          </button>
        </div>

      {!isSuperAdmin && <CompanyBranding collapsed={collapsed} />}

      {isSuperAdmin && <VerticalSwitcher collapsed={collapsed} />}

      <nav className={styles.nav}>
        {NAV_ITEMS.filter((item) => !(isSuperAdmin && item.href === "/pricing")).map(({ href, labelKey, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              title={t(labelKey)}
              aria-current={active ? "page" : undefined}
              className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
            >
              <span className={styles.navIconBox}>
                <Icon />
              </span>
              {!collapsed && <span className={styles.navLabel}>{t(labelKey)}</span>}
            </Link>
          );
        })}

        <Link
          href="/help"
          title={t("nav.help")}
          aria-current={pathname === "/help" ? "page" : undefined}
          className={`${styles.navItem} ${pathname === "/help" ? styles.navItemActive : ""}`}
        >
          <span className={styles.navIconBox}>
            <HelpIcon />
          </span>
          {!collapsed && <span className={styles.navLabel}>{t("nav.help")}</span>}
        </Link>

        {isSuperAdmin && (
          <>
            {ADMIN_SECTIONS.map((section) => {
              const open = navOpen[section.key];
              const active = section.match(pathname);
              return (
                <div key={section.key} className={styles.navSectionWrap}>
                  <button
                    type="button"
                    title={t(section.labelKey)}
                    aria-expanded={collapsed ? undefined : open}
                    aria-current={active ? "page" : undefined}
                    className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                    onClick={() => handleSectionClick(section)}
                  >
                    <span className={styles.navIconBox}>
                      <section.Icon />
                    </span>
                    {!collapsed && (
                      <>
                        <span className={styles.navLabel}>{t(section.labelKey)}</span>
                        <span className={styles.chevron}>{open ? "▾" : "▸"}</span>
                      </>
                    )}
                  </button>
                  {!collapsed && open && (
                    <div className={styles.navChildren}>
                      {section.children.map((child, i) => {
                        const childActive = child.match(pathname);
                        return (
                          <Link
                            key={`${child.href}-${i}`}
                            href={child.href}
                            aria-current={childActive ? "page" : undefined}
                            className={`${styles.navChildItem} ${childActive ? styles.navChildItemActive : ""}`}
                          >
                            {t(child.labelKey)}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>

      {/* Every page's mobile top bar drops language/theme/font-scale to
          keep that row to navigation + account-critical actions only - both
          TopHeader.module.css's own .desktopOnlyActions (the shared header
          every page but Chat uses) and chat/page.tsx's ChatMobileTopBar
          hide these below 640px, so they need a home somewhere still
          reachable, and the drawer they all open from is the natural
          place. Grouped under its own label so they read as a deliberate
          settings section, not loose items appended to the nav list.
          Layout-level, not scoped to any one route - CSS-scoped only to
          the mobile drawer width (see .mobileSettingsSection). */}
      <div className={styles.mobileSettingsSection}>
        <div className={styles.mobileSettingsLabel}>{t("sidebar.settings")}</div>
        <div className={styles.mobileSettingsRow}>
          <div className={styles.mobileFontScaleGroup}>
            <button
              type="button"
              className={styles.mobileFontScaleButton}
              title={t("topbar.decreaseFont")}
              aria-label={t("topbar.decreaseFont")}
              onClick={decrease}
            >
              A-
            </button>
            <span className={styles.mobileFontScalePct}>{scale}%</span>
            <button
              type="button"
              className={`${styles.mobileFontScaleButton} ${styles.mobileFontScaleButtonBig}`}
              title={t("topbar.increaseFont")}
              aria-label={t("topbar.increaseFont")}
              onClick={increase}
            >
              A+
            </button>
          </div>
          <LanguageToggle />
          <button
            type="button"
            className={styles.mobileThemeButton}
            title={t("topbar.toggleTheme")}
            aria-label={t("topbar.toggleTheme")}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.footerRow}>
          <div className={styles.avatar} title={fullName || user?.email}>
            {initials}
          </div>
          {!collapsed && (
            <>
              <div className={styles.footerInfo}>
                <div className={styles.footerEmail}>{fullName || user?.email}</div>
                <div className={styles.footerRole}>{user ? t(`role.${user.role}` as never) : ""}</div>
              </div>
              <button
                type="button"
                className={styles.signOutButton}
                title={t("nav.signOut")}
                aria-label={t("nav.signOut")}
                onClick={handleLogout}
              >
                <LogoutIcon size={15} />
              </button>
            </>
          )}
        </div>
      </div>
      </aside>
    </>
  );
}

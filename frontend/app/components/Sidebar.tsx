"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { API_URL } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCompany } from "../lib/company";
import { useLocale } from "../lib/i18n";
import { useVertical, type SelectedVertical } from "../lib/vertical";
import { LogoMark } from "./Logo";
import {
  ChatIcon,
  CompaniesIcon,
  NavDashboardIcon,
  NavKnowledgeBaseIcon,
  SearchIcon,
  SettingsIcon,
  SourcesIcon,
} from "./NavIcons";
import { LogoutIcon } from "./StatIcons";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/dashboard", labelKey: "nav.dashboard", Icon: NavDashboardIcon, match: (p: string) => p === "/dashboard" },
  { href: "/sources", labelKey: "nav.sources", Icon: SourcesIcon, match: (p: string) => p.startsWith("/sources") || p.startsWith("/documents") },
  { href: "/search", labelKey: "nav.search", Icon: SearchIcon, match: (p: string) => p === "/search" },
  { href: "/chat", labelKey: "nav.chat", Icon: ChatIcon, match: (p: string) => p === "/chat" },
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

// First letter of the first name + first letter of the surname (last
// whitespace-separated word) - falls back to the email's first letter for
// the many accounts that have no `name` set yet (self-registration doesn't
// collect one; see backend/app/routers/auth.py's RegisterRequest).
function getInitials(name: string | null | undefined, email: string | undefined): string {
  const trimmed = name?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }
  return email?.[0]?.toUpperCase() ?? "?";
}

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
                style={{ borderColor: active ? accent : "#d8d0c2", background: active ? accent : "transparent" }}
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
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState<Record<string, boolean>>({ kb: true, org: false, settings: false });

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
  }, []);

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

  const initials = getInitials(user?.name, user?.email);

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""}`}>
      <div className={styles.wordmarkRow}>
        {collapsed ? (
          <LogoMark size={24} />
        ) : (
          <div>
            <div className={styles.wordmarkText}>theke</div>
            <div className={styles.wordmarkSub}>{t("sidebar.adminLabel")}</div>
          </div>
        )}
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
        {NAV_ITEMS.map(({ href, labelKey, Icon, match }) => {
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

      <div className={styles.footer}>
        <div className={styles.footerRow}>
          <div className={styles.avatar} title={user?.name ?? user?.email}>
            {initials}
          </div>
          {!collapsed && (
            <>
              <div className={styles.footerInfo}>
                <div className={styles.footerEmail}>{user?.name || user?.email}</div>
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
  );
}

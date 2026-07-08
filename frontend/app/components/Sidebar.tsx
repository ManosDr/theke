"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { useVertical, type SelectedVertical } from "../lib/vertical";
import { Logo } from "./Logo";
import {
  ChatIcon,
  ChevronIcon,
  CompaniesIcon,
  DashboardIcon,
  DataSourcesIcon,
  DocumentsIcon,
  SearchIcon,
  SettingsIcon,
  SourcesIcon,
} from "./NavIcons";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/dashboard", labelKey: "nav.dashboard", Icon: DashboardIcon, match: (p: string) => p === "/dashboard" },
  { href: "/sources", labelKey: "nav.sources", Icon: SourcesIcon, match: (p: string) => p.startsWith("/sources") || p.startsWith("/documents") },
  { href: "/search", labelKey: "nav.search", Icon: SearchIcon, match: (p: string) => p === "/search" },
  { href: "/chat", labelKey: "nav.chat", Icon: ChatIcon, match: (p: string) => p === "/chat" },
] as const;

// Section headers with children, per the admin redesign's nav tree
// (Γνωσιακή Βάση / Ρυθμίσεις Συστήματος). "Εταιρείες & Χρήστες" in the
// design brief collapses to a flat "Εταιρείες" item here - user/invite
// management lives inside the company detail modal instead of separate
// cross-tenant Χρήστες/Προσκλήσεις screens (see KNOWN_DECISIONS.md).
const ADMIN_SECTIONS = [
  {
    key: "knowledgeBase",
    labelKey: "nav.knowledgeBase",
    Icon: DocumentsIcon,
    children: [
      { href: "/admin/documents", labelKey: "nav.documents", match: (p: string) => p === "/admin/documents" },
      { href: "/admin/data-sources", labelKey: "nav.dataSources", match: (p: string) => p === "/admin/data-sources" },
    ],
  },
] as const;

const VERTICAL_OPTIONS: { value: SelectedVertical; labelKey: "vertical.construction" | "vertical.tax_accounting" | "vertical.all" }[] = [
  { value: "construction", labelKey: "vertical.construction" },
  { value: "tax_accounting", labelKey: "vertical.tax_accounting" },
  { value: "all", labelKey: "vertical.all" },
];

function VerticalSwitcher() {
  const { selectedVertical, setSelectedVertical } = useVertical();
  const { t } = useLocale();

  return (
    <div className={styles.verticalSwitcher} role="tablist" aria-label={t("nav.knowledgeBase")}>
      {VERTICAL_OPTIONS.map((opt) => {
        const active = selectedVertical === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${styles.verticalSegment} ${active ? styles[`verticalSegment_${opt.value}`] : ""}`}
            onClick={() => setSelectedVertical(opt.value)}
          >
            {t(opt.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const { user } = useAuth();
  const { t } = useLocale();
  const pathname = usePathname() ?? "";
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ knowledgeBase: true, systemSettings: true });

  const isSuperAdmin = user?.role === "super_admin";

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className={styles.sidebar}>
      <Link href="/dashboard" className={styles.logoLink}>
        <Logo size={32} />
      </Link>

      {isSuperAdmin && <VerticalSwitcher />}

      <nav className={styles.nav}>
        {NAV_ITEMS.map(({ href, labelKey, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link key={href} href={href} className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}>
              <Icon />
              <span>{t(labelKey)}</span>
            </Link>
          );
        })}

        {isSuperAdmin && (
          <>
            {ADMIN_SECTIONS.map((section) => {
              const open = openSections[section.key];
              return (
                <div key={section.key} className={styles.navSection}>
                  <button type="button" className={styles.navSectionHeader} onClick={() => toggleSection(section.key)}>
                    <section.Icon />
                    <span>{t(section.labelKey)}</span>
                    <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>
                      <ChevronIcon size={14} />
                    </span>
                  </button>
                  {open && (
                    <div className={styles.navChildren}>
                      {section.children.map((child) => {
                        const active = child.match(pathname);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`${styles.navChildItem} ${active ? styles.navChildItemActive : ""}`}
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

            <Link
              href="/admin/companies"
              className={`${styles.navItem} ${pathname === "/admin/companies" ? styles.navItemActive : ""}`}
            >
              <CompaniesIcon />
              <span>{t("nav.companies")}</span>
            </Link>

            <div className={styles.navSection}>
              <button
                type="button"
                className={styles.navSectionHeader}
                onClick={() => toggleSection("systemSettings")}
              >
                <SettingsIcon />
                <span>{t("nav.systemSettings")}</span>
                <span className={`${styles.chevron} ${openSections.systemSettings ? styles.chevronOpen : ""}`}>
                  <ChevronIcon size={14} />
                </span>
              </button>
              {openSections.systemSettings && (
                <div className={styles.navChildren}>
                  <Link
                    href="/admin/verticals"
                    className={`${styles.navChildItem} ${pathname === "/admin/verticals" ? styles.navChildItemActive : ""}`}
                  >
                    {t("nav.verticalsContent")}
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </nav>
    </aside>
  );
}

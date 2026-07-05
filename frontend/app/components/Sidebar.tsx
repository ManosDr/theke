"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { Logo } from "./Logo";
import { ChatIcon, DashboardIcon, SearchIcon, ShieldIcon, SourcesIcon } from "./NavIcons";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/dashboard", labelKey: "nav.dashboard", Icon: DashboardIcon, match: (p: string) => p === "/dashboard" },
  { href: "/sources", labelKey: "nav.sources", Icon: SourcesIcon, match: (p: string) => p.startsWith("/sources") || p.startsWith("/documents") },
  { href: "/search", labelKey: "nav.search", Icon: SearchIcon, match: (p: string) => p === "/search" },
  { href: "/chat", labelKey: "nav.chat", Icon: ChatIcon, match: (p: string) => p === "/chat" },
] as const;

// Both routes hit the same backend queue (see StaleDocumentsQueue's
// comment) - listed separately since both were asked for as distinct
// entry points, not because the data actually differs.
const SUPER_ADMIN_NAV_ITEMS = [
  {
    href: "/admin/stale-documents",
    labelKey: "nav.staleDocuments",
    Icon: ShieldIcon,
    match: (p: string) => p === "/admin/stale-documents",
  },
  {
    href: "/admin/needs-review",
    labelKey: "nav.needsReview",
    Icon: ShieldIcon,
    match: (p: string) => p === "/admin/needs-review",
  },
] as const;

export function Sidebar() {
  const { user } = useAuth();
  const { t } = useLocale();
  const pathname = usePathname() ?? "";

  const items = user?.role === "super_admin" ? [...NAV_ITEMS, ...SUPER_ADMIN_NAV_ITEMS] : NAV_ITEMS;

  return (
    <aside className={styles.sidebar}>
      <Link href="/dashboard" className={styles.logoLink}>
        <Logo size={32} />
      </Link>

      <nav className={styles.nav}>
        {items.map(({ href, labelKey, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link key={href} href={href} className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}>
              <Icon />
              <span>{t(labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

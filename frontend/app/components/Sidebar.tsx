"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useLocale } from "../lib/i18n";
import { Logo } from "./Logo";
import { ChatIcon, DashboardIcon, SearchIcon, SourcesIcon } from "./NavIcons";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/dashboard", labelKey: "nav.dashboard", Icon: DashboardIcon, match: (p: string) => p === "/dashboard" },
  { href: "/sources", labelKey: "nav.sources", Icon: SourcesIcon, match: (p: string) => p.startsWith("/sources") || p.startsWith("/documents") },
  { href: "/search", labelKey: "nav.search", Icon: SearchIcon, match: (p: string) => p === "/search" },
  { href: "/chat", labelKey: "nav.chat", Icon: ChatIcon, match: (p: string) => p === "/chat" },
] as const;

export function Sidebar() {
  const { t } = useLocale();
  const pathname = usePathname() ?? "";

  return (
    <aside className={styles.sidebar}>
      <Link href="/dashboard" className={styles.logoLink}>
        <Logo size={32} />
      </Link>

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
      </nav>
    </aside>
  );
}

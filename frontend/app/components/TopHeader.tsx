"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { NotificationBell } from "./NotificationBell";
import { SearchIcon } from "./NavIcons";
import styles from "./TopHeader.module.css";
import { UserMenu } from "./UserMenu";

function pageTitleKey(pathname: string): TranslationKey {
  if (pathname.startsWith("/sources") || pathname.startsWith("/documents")) return "nav.sources";
  if (pathname === "/search") return "nav.search";
  if (pathname === "/chat") return "nav.chat";
  return "nav.dashboard";
}

export function TopHeader() {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? "/dashboard";
  const [query, setQuery] = useState("");

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      router.push("/search");
      return;
    }
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{t(pageTitleKey(pathname))}</h1>

      <form className={styles.searchForm} onSubmit={handleSearchSubmit}>
        <SearchIcon size={18} />
        <input
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("common.searchPlaceholder")}
          aria-label={t("common.searchPlaceholder")}
        />
      </form>

      <div className={styles.actions}>
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

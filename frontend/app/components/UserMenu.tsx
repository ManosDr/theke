"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { LanguageToggle } from "./LanguageToggle";
import { GlobeIcon, LogoutIcon, SunMoonIcon } from "./StatIcons";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./UserMenu.module.css";

export function UserMenu() {
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
            <span className={styles.itemLabel}>
              <GlobeIcon />
              {t("nav.language")}
            </span>
            <LanguageToggle />
          </div>
          <div className={styles.dropdownItem} role="menuitem">
            <span className={styles.itemLabel}>
              <SunMoonIcon />
              {t("nav.theme")}
            </span>
            <ThemeToggle />
          </div>
          <button className={`${styles.dropdownItem} ${styles.dropdownButton}`} role="menuitem" onClick={handleLogout}>
            <span className={styles.itemLabel}>
              <LogoutIcon />
              {t("nav.signOut")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

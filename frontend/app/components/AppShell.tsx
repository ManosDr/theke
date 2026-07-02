"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth } from "../lib/auth";
import styles from "./AppShell.module.css";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  member: "Member",
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

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
            Dashboard
          </Link>
          <Link href="/chat" className={`${styles.navLink} ${pathname === "/chat" ? styles.navLinkActive : ""}`}>
            Chat
          </Link>
        </nav>

        <div className={styles.userMenu}>
          <ThemeToggle />
          {user && (
            <div className={styles.userInfo}>
              <span className={styles.userEmail}>{user.email}</span>
              <span className="text-muted">{ROLE_LABELS[user.role] ?? user.role}</span>
            </div>
          )}
          <button className="btn btn-secondary" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}

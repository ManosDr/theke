"use client";

import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";
import { TopHeader } from "./TopHeader";

export function AppShell({ children, fullWidth = false }: { children: ReactNode; fullWidth?: boolean }) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.content}>
        <TopHeader />
        <main className={`${styles.main} ${fullWidth ? styles.mainFullWidth : ""}`}>{children}</main>
      </div>
    </div>
  );
}

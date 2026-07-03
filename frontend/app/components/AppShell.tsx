"use client";

import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";
import { TopHeader } from "./TopHeader";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.content}>
        <TopHeader />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}

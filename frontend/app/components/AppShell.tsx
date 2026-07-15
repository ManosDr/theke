"use client";

import type { ReactNode } from "react";

import { FeedbackWidget } from "./FeedbackWidget";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";
import { TopHeader } from "./TopHeader";
import { TrialBanner } from "./TrialBanner";

export function AppShell({ children, fullWidth = false }: { children: ReactNode; fullWidth?: boolean }) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.content}>
        <TopHeader />
        <ImpersonationBanner />
        <TrialBanner />
        <main className={`${styles.main} ${fullWidth ? styles.mainFullWidth : ""}`}>{children}</main>
      </div>
      <FeedbackWidget />
    </div>
  );
}

"use client";

import type { ReactNode } from "react";

import { Day45Banner } from "./Day45Banner";
import { FeedbackWidget } from "./FeedbackWidget";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";
import { TopHeader, TrialBadgeBar } from "./TopHeader";
import { TrialBanner } from "./TrialBanner";

export function AppShell({
  children,
  fullWidth = false,
  mobileHeader,
}: {
  children: ReactNode;
  fullWidth?: boolean;
  // Swaps in a page-specific compact header below the mobile breakpoint,
  // in place of the shared TopHeader row - the shared header keeps
  // rendering normally (all widths) everywhere this isn't passed, so
  // no other page is affected. See chat/page.tsx's mobile redesign.
  mobileHeader?: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.content}>
        {mobileHeader ? (
          <>
            <div className={styles.mobileHeaderSlot}>{mobileHeader}</div>
            <div className={styles.desktopHeaderSlot}>
              <TopHeader />
            </div>
          </>
        ) : (
          <TopHeader />
        )}
        <TrialBadgeBar />
        <ImpersonationBanner />
        <TrialBanner />
        <Day45Banner />
        <main className={`${styles.main} ${fullWidth ? styles.mainFullWidth : ""}`}>{children}</main>
      </div>
      <FeedbackWidget />
    </div>
  );
}

"use client";

import type { ReactNode } from "react";

import { FeedbackWidget } from "./FeedbackWidget";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";
import { TopHeader, TrialBadgeBar } from "./TopHeader";
import { TrialBanner } from "./TrialBanner";
import { TrialNudgeBanner } from "./TrialNudgeBanner";

export function AppShell({
  children,
  fullWidth = false,
  edgeToEdge = false,
  mobileHeader,
}: {
  children: ReactNode;
  fullWidth?: boolean;
  // Drops .main's padding/max-width/margin entirely (not just the max-width
  // cap that fullWidth drops) - for a page that renders its own full-height,
  // edge-to-edge chrome and owns its own background all the way to the top
  // bar/viewport edges, rather than sitting as a padded card on top of the
  // shell's --admin-parchment background. See chat/page.tsx.
  edgeToEdge?: boolean;
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
        <TrialNudgeBanner />
        <main
          className={`${styles.main} ${fullWidth ? styles.mainFullWidth : ""} ${edgeToEdge ? styles.mainEdgeToEdge : ""}`}
        >
          {children}
        </main>
      </div>
      <FeedbackWidget />
    </div>
  );
}

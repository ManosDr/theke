"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { LanguageToggle } from "../components/LanguageToggle";
import { LegalFooter } from "../components/LegalFooter";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { SubscriptionStatusResponse } from "../lib/types";
import styles from "../login/login.module.css";

// How often to re-check GET /subscription/status while parked here, so an
// approval lands within a bounded wait instead of requiring a manual
// refresh - this is the ONE endpoint reachable in this state (see
// backend/app/dependencies.py's get_current_user_allow_pending), so
// there's nothing else for this page to call to detect the change.
const POLL_INTERVAL_MS = 30_000;

export default function PendingApprovalPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const { t } = useLocale();
  const [status, setStatus] = useState<SubscriptionStatusResponse["status"] | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.companyId === null) {
      // super_admin - has no subscription, nothing to be pending on.
      router.replace("/dashboard");
      return;
    }

    let cancelled = false;
    async function check() {
      if (checking.current) return;
      checking.current = true;
      try {
        const data = await api.get<SubscriptionStatusResponse>("/subscription/status", user!.token);
        if (cancelled) return;
        setStatus(data.status);
        // Approved (or any other real status) - nothing left to wait for.
        if (data.status !== "beta_pending" && data.status !== "rejected") {
          router.replace("/dashboard");
        }
      } finally {
        checking.current = false;
      }
    }

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loading, user, router]);

  const isRejected = status === "rejected";

  return (
    <main className={styles.page}>
      <div className={styles.themeToggle} style={{ display: "flex", gap: "var(--space-2)" }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className={styles.intro}>
        <Logo height="2.5rem" />
      </div>

      <div className={`card ${styles.card}`} style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "1.1rem", margin: 0 }}>
          {isRejected ? t("pendingApproval.rejectedTitle") : t("pendingApproval.title")}
        </h1>
        <p className="text-muted" style={{ margin: 0 }}>
          {isRejected ? t("pendingApproval.rejectedBody") : t("pendingApproval.body")}
        </p>
        {!isRejected && (
          <p className="text-muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            {t("pendingApproval.hint")}
          </p>
        )}
        <button type="button" className="btn btn-secondary" onClick={logout}>
          {t("pendingApproval.logout")}
        </button>
      </div>
      <LegalFooter />
    </main>
  );
}

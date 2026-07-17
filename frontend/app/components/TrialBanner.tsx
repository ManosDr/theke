"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { SubscriptionStatusResponse } from "../lib/types";
import styles from "./TrialBanner.module.css";

const AMBER_THRESHOLD_DAYS = 14;
const URGENT_THRESHOLD_DAYS = 3;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

// super_admin has no company_id (nothing to be on trial), so this fetches
// nothing and renders nothing for that role - see subscription.py's status
// endpoint, which 404s for the same reason.
export function TrialBanner() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState<SubscriptionStatusResponse | null>(null);

  const eligible = !!user && user.role !== "super_admin" && user.companyId != null;

  useEffect(() => {
    if (!eligible || !user) return;
    api
      .get<SubscriptionStatusResponse>("/subscription/status", user.token)
      .then(setStatus)
      .catch(() => setStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, user?.token]);

  if (!eligible || !status || !user) return null;

  function goToPlans() {
    router.push("/pricing");
  }

  if (status.status === "expired" || status.status === "cancelled") {
    return (
      <div className={styles.overlay} role="alertdialog" aria-modal="true">
        <div className={styles.card}>
          <h2>{status.status === "cancelled" ? t("trialBanner.cancelledTitle") : t("trialBanner.expiredTitle")}</h2>
          <p>{status.status === "cancelled" ? t("trialBanner.cancelledBody") : t("trialBanner.expiredBody")}</p>
          <div className={styles.overlayActions}>
            <a
              className="btn btn-primary"
              href={`mailto:sales@theke.gr?subject=${encodeURIComponent("Αναβάθμιση πλάνου")}`}
            >
              {t("trialBanner.contactUpgrade")}
            </a>
            <button type="button" className="btn btn-secondary" onClick={logout}>
              {t("nav.signOut")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status.status !== "trial" || !status.trial_ends_at) return null;

  const days = daysUntil(status.trial_ends_at);
  if (days > AMBER_THRESHOLD_DAYS) return null;

  const daysText = days <= 1 ? t("trialBanner.oneDay") : t("trialBanner.days", { days });
  const urgent = days <= URGENT_THRESHOLD_DAYS;

  return (
    <div className={styles.bar} data-level={urgent ? "urgent" : "amber"} role="status">
      <span>{urgent ? t("trialBanner.urgent", { days: daysText }) : t("trialBanner.amber", { days: daysText })}</span>
      {urgent && (
        <button type="button" className={styles.viewPlansButton} onClick={goToPlans}>
          {t("trialBanner.viewPlans")}
        </button>
      )}
    </div>
  );
}

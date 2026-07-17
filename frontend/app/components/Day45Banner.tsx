"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "../lib/api";
import { companyTypeToVerticalSlug, useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { PlansPublicResponse, SubscriptionStatusResponse } from "../lib/types";
import styles from "./TrialBanner.module.css";

const NUDGE_DAY = 45;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// Recommends a tier by this month's message volume against each tier's own
// pool (Starter/Professional/Business, in that price order - see GET
// /plans, which is already sorted by price_eur ascending). Zero messages by
// day 45 defaults to Professional rather than Starter, per the spec's own
// explicit rule - a silent/unused trial isn't evidence the lightest tier
// would actually fit them.
function recommendedTierIndex(messagesUsed: number): number {
  if (messagesUsed === 0) return 1;
  if (messagesUsed <= 300) return 0;
  if (messagesUsed <= 1000) return 1;
  return 2;
}

// Shown once a trial company reaches day 45 (see SubscriptionStatusResponse.
// trial_started_at) - a personalized nudge naming their real usage and the
// tier it maps to, distinct from TrialBanner's countdown-to-expiry warning.
// Never shown for is_test_account companies (Phase 5's reporting exclusion).
export function Day45Banner() {
  const { user } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState<SubscriptionStatusResponse | null>(null);
  const [plans, setPlans] = useState<PlansPublicResponse | null>(null);

  const eligible = !!user && user.role !== "super_admin" && user.companyId != null;

  useEffect(() => {
    if (!eligible || !user) return;
    api
      .get<SubscriptionStatusResponse>("/subscription/status", user.token)
      .then(setStatus)
      .catch(() => setStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, user?.token]);

  useEffect(() => {
    if (!eligible || !user || !status || status.status !== "trial" || status.is_test_account) return;
    if (daysSince(status.trial_started_at) < NUDGE_DAY) return;
    const vertical = companyTypeToVerticalSlug(user.companyType);
    api
      .get<PlansPublicResponse>(`/plans?vertical=${vertical}`, user.token)
      .then(setPlans)
      .catch(() => setPlans(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, user?.token, status]);

  if (!eligible || !status || !user) return null;
  if (status.status !== "trial" || status.is_test_account) return null;
  if (daysSince(status.trial_started_at) < NUDGE_DAY) return null;
  if (!plans || plans.tiers.length < 3) return null;

  const tier = plans.tiers[recommendedTierIndex(status.messages_used)];
  if (!tier || tier.annual_monthly_equiv_eur == null) return null;

  return (
    <div className={styles.bar} data-level="amber" role="status">
      <span>
        {t("day45Banner.message", {
          count: status.messages_used,
          tier: tier.name,
          price: tier.annual_monthly_equiv_eur.toFixed(2),
        })}
      </span>
      <button type="button" className={styles.viewPlansButton} onClick={() => router.push("/pricing")}>
        {t("trialBanner.viewPlans")}
      </button>
    </div>
  );
}

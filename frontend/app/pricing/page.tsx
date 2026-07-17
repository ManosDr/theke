"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../components/AppShell";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError, api } from "../lib/api";
import { companyTypeToVerticalSlug, useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { PlanPublicEntry, PlanRequestResponse, PlansPublicResponse } from "../lib/types";
import styles from "./pricing.module.css";

type VerticalTab = "construction" | "tax_accounting";

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function PricingPage() {
  const { user } = useAuth();

  if (user) {
    return (
      <AppShell>
        <PricingContent />
      </AppShell>
    );
  }
  return (
    <main className={styles.publicPage}>
      <div className={styles.publicHeader}>
        <Logo size={36} />
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
      <PricingContent />
    </main>
  );
}

function PricingContent() {
  const { user } = useAuth();
  const { t, locale } = useLocale();
  const router = useRouter();

  const defaultTab: VerticalTab = user ? companyTypeToVerticalSlug(user.companyType) : "construction";
  const [tab, setTab] = useState<VerticalTab>(defaultTab);
  const [data, setData] = useState<PlansPublicResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<PlanRequestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<PlansPublicResponse>(`/plans?vertical=${tab}`, user?.token)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user?.token]);

  const currentTier = data?.tiers.find((tier) => tier.is_current) ?? null;

  async function requestPlan(tier: PlanPublicEntry) {
    if (!user) {
      router.push(`/register?intended_tier=${encodeURIComponent(tier.slug)}`);
      return;
    }
    setRequesting(tier.id);
    setError(null);
    try {
      const result = await api.post<PlanRequestResponse>("/plan-requests", { requested_tier_id: tier.id }, user.token);
      setConfirmation(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRequesting(null);
    }
  }

  function ctaLabel(tier: PlanPublicEntry): string {
    if (!currentTier) return t("pricing.ctaUpgrade");
    return tier.price_eur < currentTier.price_eur ? t("pricing.ctaDowngrade") : t("pricing.ctaUpgrade");
  }

  return (
    <div className={styles.wrap}>
      <h1>{t("nav.pricing")}</h1>

      {data?.subscription_status === "trial" && data.trial_ends_at && (
        <p className={styles.trialLine}>
          {t("pricing.trialLine", { days: Math.max(0, daysUntil(data.trial_ends_at)) })}
        </p>
      )}

      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "construction"}
          className={`${styles.tabButton} ${tab === "construction" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("construction")}
        >
          {t("vertical.construction")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tax_accounting"}
          className={`${styles.tabButton} ${tab === "tax_accounting" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("tax_accounting")}
        >
          {t("vertical.tax_accounting")}
        </button>
      </div>

      {loading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : (
        <div className={styles.grid}>
          {(data?.tiers ?? []).map((tier) => (
            <div key={tier.id} className={`card ${styles.tierCard}`}>
              {tier.is_current && <div className={styles.currentBadge}>{t("pricing.currentPlanBadge")}</div>}
              <h2 className={styles.tierName}>{tier.name}</h2>

              <div className={styles.priceBlock}>
                {tier.annual_monthly_equiv_eur != null ? (
                  <>
                    <div className={styles.pricePrimary}>
                      €{tier.annual_monthly_equiv_eur.toFixed(2)}
                      <span className={styles.pricePeriod}>/{t("pricing.perMonth")}</span>
                    </div>
                    <div className={styles.priceSecondary}>
                      €{tier.price_eur.toFixed(2)}/{t("pricing.perMonth")} {t("pricing.billedMonthly")}
                    </div>
                    {tier.annual_total_eur != null && (
                      <div className={styles.annualTotal}>
                        {t("pricing.annualTotalLine", { total: tier.annual_total_eur.toFixed(2) })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className={styles.pricePrimary}>
                    €{tier.price_eur.toFixed(2)}
                    <span className={styles.pricePeriod}>/{t("pricing.perMonth")}</span>
                  </div>
                )}
              </div>

              <ul className={styles.features}>
                <li>{t("pricing.usersFeature", { n: tier.user_limit })}</li>
                <li>{t("pricing.messagesFeature", { n: tier.message_pool.toLocaleString(locale) })}</li>
                {tier.project_limit != null && <li>{t("pricing.projectsFeature", { n: tier.project_limit })}</li>}
                {tier.client_limit != null && <li>{t("pricing.clientsFeature", { n: tier.client_limit })}</li>}
                {tier.storage_limit_bytes != null && (
                  <li>
                    {t("pricing.documentsFeature", {
                      n: Math.floor(tier.storage_limit_bytes / tier.max_file_size_bytes).toLocaleString(locale),
                    })}
                    <div className={styles.featureSubtext}>{t("pricing.perCompany")}</div>
                  </li>
                )}
              </ul>

              {tier.is_current ? (
                <div className={styles.currentCta}>{t("pricing.currentPlanCta")}</div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={requesting === tier.id}
                  onClick={() => requestPlan(tier)}
                >
                  {ctaLabel(tier)}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

      <p className={styles.disclaimer}>
        {t("pricing.disclaimerVat")}
        <br />
        {t("pricing.disclaimerNonAnnual")}
      </p>

      {confirmation && (
        <div className={styles.modalScrim} onClick={() => setConfirmation(null)}>
          <div className={`card ${styles.confirmCard}`} onClick={(e) => e.stopPropagation()}>
            <p>
              {confirmation.direction === "downgrade"
                ? t("pricing.confirmDowngrade", { tier: confirmation.requested_tier_name })
                : t("pricing.confirmUpgrade", { tier: confirmation.requested_tier_name })}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setConfirmation(null)}>
              {t("common.dismiss")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

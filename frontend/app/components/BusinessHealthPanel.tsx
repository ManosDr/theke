"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { BusinessHealthResponse } from "../lib/types";
import { CoinIcon, InfoIcon, UsersIcon } from "./StatIcons";
import ExplainerTooltip from "./Tooltip";
import styles from "../dashboard/dashboard.module.css";

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-text)",
};

function TrendChart({
  data,
  lines,
  height = 220,
}: {
  data: Record<string, unknown>[];
  lines: { dataKey: string; name: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
        <RechartsTooltip contentStyle={tooltipStyle} />
        {lines.map((line) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BusinessHealthPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const [data, setData] = useState<BusinessHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!user?.token) return;
    setLoading(true);
    api
      .get<BusinessHealthResponse>(`/admin/business-health?days=${days}`, user.token)
      .then(setData)
      .finally(() => setLoading(false));
  }, [user?.token, days]);

  const chartData = (data?.timeline ?? []).map((d) => ({
    date: d.date.slice(5),
    spend_eur: d.spend_eur,
    messages: d.messages,
    real_companies_cumulative: d.real_companies_cumulative,
    real_users_cumulative: d.real_users_cumulative,
    gap_rate: d.gap_rate,
    feedback_ratio: d.feedback_ratio,
  }));

  const hasData = (data?.timeline?.length ?? 0) > 0 && data!.timeline.some((d) => d.messages > 0 || d.spend_eur > 0);

  return (
    <div>
      <h1>{t("admin.businessHealth.title")}</h1>
      <p className="text-muted">{t("admin.businessHealth.description")}</p>

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
        <button
          type="button"
          className={`btn ${days === 30 ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setDays(30)}
        >
          {t("admin.businessHealth.range30")}
        </button>
        <button
          type="button"
          className={`btn ${days === 90 ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setDays(90)}
        >
          {t("admin.businessHealth.range90")}
        </button>
      </div>

      {loading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : !hasData ? (
        <section className={`card ${styles.section}`}>
          <p className={styles.emptyState}>{t("admin.businessHealth.noData")}</p>
        </section>
      ) : (
        <>
          <section className={`card ${styles.section}`}>
            <div className={styles.kbHealthStats}>
              <div>
                <span className={styles.value}>
                  <CoinIcon size={18} /> €{data!.total_spend_eur.toFixed(2)}
                </span>
                <span className={styles.label}>{t("admin.businessHealth.totalSpend")}</span>
              </div>
              <div>
                <span className={styles.value}>
                  <UsersIcon size={18} /> {data!.real_active_users_period}
                  <ExplainerTooltip text={t("admin.businessHealth.realActiveUsersTooltip")}>
                    <InfoIcon size={11} />
                  </ExplainerTooltip>
                </span>
                <span className={styles.label}>{t("admin.businessHealth.realActiveUsers")}</span>
              </div>
              <div>
                <span className={styles.value}>
                  {data!.cost_per_real_active_user_eur !== null
                    ? `€${data!.cost_per_real_active_user_eur.toFixed(2)}`
                    : "—"}
                  <ExplainerTooltip text={t("admin.businessHealth.costPerUserTooltip")}>
                    <InfoIcon size={11} />
                  </ExplainerTooltip>
                </span>
                <span className={styles.label}>
                  {data!.cost_per_real_active_user_eur !== null
                    ? t("admin.businessHealth.costPerUser")
                    : t("admin.businessHealth.costPerUserUnavailable")}
                </span>
              </div>
            </div>
          </section>

          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{t("admin.businessHealth.spendMessagesTitle")}</h2>
            </div>
            <p className="text-muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
              {t("admin.businessHealth.spendMessagesDescription")}
            </p>
            <TrendChart
              data={chartData}
              lines={[
                { dataKey: "spend_eur", name: t("admin.businessHealth.chartSpend"), color: "var(--color-primary)" },
                { dataKey: "messages", name: t("admin.businessHealth.chartMessages"), color: "var(--color-info)" },
              ]}
            />
          </section>

          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{t("admin.businessHealth.growthTitle")}</h2>
            </div>
            <p className="text-muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
              {t("admin.businessHealth.growthDescription")}
            </p>
            <TrendChart
              data={chartData}
              lines={[
                {
                  dataKey: "real_companies_cumulative",
                  name: t("admin.businessHealth.chartCompanies"),
                  color: "var(--admin-construction)",
                },
                {
                  dataKey: "real_users_cumulative",
                  name: t("admin.businessHealth.chartUsers"),
                  color: "var(--admin-tax)",
                },
              ]}
            />
          </section>

          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{t("admin.businessHealth.qualityTitle")}</h2>
            </div>
            <p className="text-muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
              {t("admin.businessHealth.qualityDescription")}
            </p>
            <TrendChart
              data={chartData}
              lines={[{ dataKey: "gap_rate", name: t("admin.businessHealth.chartGapRate"), color: "var(--color-danger)" }]}
              height={140}
            />
            <TrendChart
              data={chartData}
              lines={[
                {
                  dataKey: "feedback_ratio",
                  name: t("admin.businessHealth.chartFeedbackRatio"),
                  color: "var(--color-success)",
                },
              ]}
              height={140}
            />
          </section>
        </>
      )}
    </div>
  );
}

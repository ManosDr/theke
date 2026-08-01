"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { SpendAlertsResponse } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";

export function SpendAlertsPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const [data, setData] = useState<SpendAlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [dailyInput, setDailyInput] = useState("");
  const [weeklyInput, setWeeklyInput] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    if (!user?.token) return;
    return api.get<SpendAlertsResponse>("/admin/spend-alerts", user.token).then((res) => {
      setData(res);
      setDailyInput(String(res.thresholds.daily_eur));
      setWeeklyInput(String(res.thresholds.weekly_eur));
    });
  }

  useEffect(() => {
    load()?.finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token]);

  async function handleSave() {
    if (!user?.token) return;
    setSaveMessage(null);
    setSaveError(null);
    setSaving(true);
    try {
      await api.patch("/admin/spend-alerts/thresholds", {
        daily_eur: parseFloat(dailyInput),
        weekly_eur: parseFloat(weeklyInput),
      }, user.token);
      await load();
      setSaveMessage(t("admin.spendAlerts.saved"));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t("admin.spendAlerts.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const chartData = (data?.history ?? []).map((h) => ({
    date: h.created_at.slice(5, 10),
    spend24h: h.spend_24h_eur,
  }));

  return (
    <div>
      <h1>{t("admin.spendAlerts.title")}</h1>
      <p className="text-muted">{t("admin.spendAlerts.description")}</p>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <h3 style={{ marginTop: 0 }}>{t("admin.spendAlerts.thresholdsTitle")}</h3>
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="text-muted" style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              {t("admin.spendAlerts.dailyThreshold")}
            </label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={dailyInput}
              onChange={(e) => setDailyInput(e.target.value)}
              style={{ width: 140 }}
            />
          </div>
          <div>
            <label className="text-muted" style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              {t("admin.spendAlerts.weeklyThreshold")}
            </label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={weeklyInput}
              onChange={(e) => setWeeklyInput(e.target.value)}
              style={{ width: 140 }}
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {t("admin.spendAlerts.save")}
          </button>
        </div>
        {saveMessage && (
          <p className="text-muted" style={{ color: "var(--color-success)", marginBottom: 0 }}>
            {saveMessage}
          </p>
        )}
        {saveError && (
          <p className="text-muted" style={{ color: "var(--color-danger)", marginBottom: 0 }}>
            {saveError}
          </p>
        )}
      </section>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : !data?.latest ? (
          <p className={styles.emptyState}>{t("admin.spendAlerts.noData")}</p>
        ) : (
          <>
            <div className={styles.kbHealthStats}>
              <div>
                <span className={styles.value}>€{data.latest.spend_24h_eur.toFixed(2)}</span>
                <span className={styles.label}>{t("admin.spendAlerts.col24h")}</span>
              </div>
              <div>
                <span className={styles.value}>€{data.latest.spend_7d_eur.toFixed(2)}</span>
                <span className={styles.label}>{t("admin.spendAlerts.col7d")}</span>
              </div>
              <div>
                <span
                  className={styles.value}
                  style={{
                    color:
                      data.latest.daily_breached || data.latest.weekly_breached
                        ? "var(--color-danger)"
                        : "var(--color-success)",
                  }}
                >
                  {data.latest.daily_breached || data.latest.weekly_breached
                    ? t("admin.spendAlerts.statusBreached")
                    : t("admin.spendAlerts.statusOk")}
                </span>
                <span className={styles.label}>{t("admin.spendAlerts.colStatus")}</span>
              </div>
            </div>

            {chartData.length > 1 && (
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <RechartsTooltip
                    contentStyle={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      color: "var(--color-text)",
                    }}
                    labelFormatter={(label) => label}
                  />
                  <Line
                    type="monotone"
                    dataKey="spend24h"
                    name={t("admin.spendAlerts.col24h")}
                    stroke="var(--color-primary)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </section>

      {data?.history && data.history.length > 0 && (
        <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{tUpper("admin.spendAlerts.colDate")}</th>
                <th>{tUpper("admin.spendAlerts.col24h")}</th>
                <th>{tUpper("admin.spendAlerts.col7d")}</th>
                <th>{tUpper("admin.spendAlerts.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {[...data.history].reverse().map((h) => (
                <tr key={h.created_at}>
                  <td className="text-muted">{new Date(h.created_at).toLocaleString()}</td>
                  <td>€{h.spend_24h_eur.toFixed(2)}</td>
                  <td>€{h.spend_7d_eur.toFixed(2)}</td>
                  <td
                    style={{
                      color: h.daily_breached || h.weekly_breached ? "var(--color-danger)" : "var(--color-success)",
                      fontWeight: 600,
                    }}
                  >
                    {h.daily_breached || h.weekly_breached
                      ? t("admin.spendAlerts.statusBreached")
                      : t("admin.spendAlerts.statusOk")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

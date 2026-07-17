"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { InfraHealthLevel, InfraHealthResponse } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";

const LEVEL_COLOR: Record<InfraHealthLevel, string> = {
  watch: "var(--color-success)",
  warning: "var(--color-warning)",
  critical: "var(--color-danger)",
};

export function InfraHealthPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const [data, setData] = useState<InfraHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.token) return;
    api
      .get<InfraHealthResponse>("/admin/infra-health", user.token)
      .then(setData)
      .finally(() => setLoading(false));
  }, [user?.token]);

  const levelLabel = (level: InfraHealthLevel) =>
    level === "critical"
      ? t("admin.infraHealth.levelCritical")
      : level === "warning"
        ? t("admin.infraHealth.levelWarning")
        : t("admin.infraHealth.levelWatch");

  const trendLabel =
    data?.trend === "up" ? "↑" : data?.trend === "down" ? "↓" : data?.trend === "flat" ? "→" : null;

  const chartData = (data?.history ?? []).map((h) => ({
    date: h.created_at.slice(5, 10),
    chunks: h.total_chunks,
  }));

  return (
    <div>
      <h1>{t("admin.infraHealth.title")}</h1>
      <p className="text-muted">{t("admin.infraHealth.description")}</p>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : !data?.latest ? (
          <p className={styles.emptyState}>{t("admin.infraHealth.noData")}</p>
        ) : (
          <>
            <div className={styles.kbHealthStats}>
              <div>
                <span className={styles.value}>{data.latest.total_chunks.toLocaleString()}</span>
                <span className={styles.label}>{t("admin.infraHealth.colChunks")}</span>
              </div>
              <div>
                <span className={styles.value}>{data.latest.index_size_mb.toFixed(1)} MB</span>
                <span className={styles.label}>{t("admin.infraHealth.colIndexSize")}</span>
              </div>
              <div>
                <span className={styles.value} style={{ color: LEVEL_COLOR[data.latest.threshold_level] }}>
                  {levelLabel(data.latest.threshold_level)}
                </span>
                <span className={styles.label}>{t("admin.infraHealth.colLevel")}</span>
              </div>
              {trendLabel && (
                <div>
                  <span className={styles.value}>{trendLabel}</span>
                  <span className={styles.label}>{t("admin.infraHealth.trend")}</span>
                </div>
              )}
            </div>

            {chartData.length > 1 && (
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <Tooltip
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
                    dataKey="chunks"
                    name={t("admin.infraHealth.colChunks")}
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
                <th>{tUpper("admin.infraHealth.colDate")}</th>
                <th>{tUpper("admin.infraHealth.colChunks")}</th>
                <th>{tUpper("admin.infraHealth.colIndexSize")}</th>
                <th>{tUpper("admin.infraHealth.colLevel")}</th>
              </tr>
            </thead>
            <tbody>
              {[...data.history].reverse().map((h) => (
                <tr key={h.created_at}>
                  <td className="text-muted">{new Date(h.created_at).toLocaleString()}</td>
                  <td>{h.total_chunks.toLocaleString()}</td>
                  <td>{h.index_size_mb.toFixed(1)} MB</td>
                  <td style={{ color: LEVEL_COLOR[h.threshold_level], fontWeight: 600 }}>
                    {levelLabel(h.threshold_level)}
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

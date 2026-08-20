"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import { SortableTh } from "./SortableTh";
import { useSortableData } from "../lib/useSortableData";
import type { AdminStatsByVertical, GapQueryEntry } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";

export function ChatGapRatePanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const [stats, setStats] = useState<AdminStatsByVertical | null>(null);
  const [queries, setQueries] = useState<GapQueryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user?.token) return;
    Promise.all([
      api.get<AdminStatsByVertical>("/admin/stats", user.token),
      api.get<GapQueryEntry[]>("/admin/gap-queries", user.token),
    ])
      .then(([statsData, gapData]) => {
        setStats(statsData);
        setQueries(gapData);
      })
      .finally(() => setLoading(false));
  }, [user?.token]);

  const filteredQueries = queries.filter((q) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return q.message.toLowerCase().includes(s) || (q.company_name ?? "").toLowerCase().includes(s);
  });
  const {
    sorted: sortedQueries,
    sortColumn,
    sortDirection,
    toggleSort,
  } = useSortableData(filteredQueries, (q, column) => {
    switch (column) {
      case "company":
        return q.company_name ?? null;
      case "when":
        return parseApiDate(q.created_at).getTime();
      default:
        return null;
    }
  });

  return (
    <div>
      <h1>{t("admin.chatGapRate.title")}</h1>
      <p className="text-muted">{t("admin.chatGapRate.description")}</p>

      {stats && (
        <p style={{ marginTop: "var(--space-2)", fontWeight: 600, color: "var(--color-danger)" }}>
          {t("admin.chatGapRate.currentRate")}: {stats.total.gap_rate}%
        </p>
      )}

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.sectionHeader}>
          <h2>{t("admin.chatGapRate.recentGaps")}</h2>
        </div>
        <p className="text-muted" style={{ marginBottom: "var(--space-3)" }}>
          {t("admin.chatGapRate.recentGapsHint")}
        </p>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : queries.length === 0 ? (
          <p className={styles.emptyState}>{t("admin.chatGapRate.noGaps")}</p>
        ) : (
          <>
            <input
              className="input"
              type="text"
              placeholder={t("admin.chatGapRate.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: "var(--space-3)", maxWidth: 320 }}
            />
            {sortedQueries.length === 0 ? (
              <p className={styles.emptyState}>{t("chat.context.noResults")}</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{tUpper("admin.chatGapRate.colQuestion")}</th>
                    <SortableTh label={tUpper("dash.super.colCompany")} column="company" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("dash.super.colWhen")} column="when" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedQueries.map((q) => (
                    <tr key={q.id}>
                      <td>{q.message}</td>
                      <td className="text-muted">{q.company_name ?? t("dash.super.platform")}</td>
                      <td className="text-muted">{parseApiDate(q.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}

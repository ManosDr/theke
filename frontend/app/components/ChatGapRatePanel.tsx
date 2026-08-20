"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import { SortableTh } from "./SortableTh";
import { useSortableData } from "../lib/useSortableData";
import type { AdminStatsByVertical, GapQueryEntry } from "../lib/types";
import dashStyles from "../dashboard/dashboard.module.css";
import styles from "./ChatGapRatePanel.module.css";

type StatusFilter = "all" | "unreviewed" | "addressed";

export function ChatGapRatePanel() {
  const { user } = useAuth();
  const { t, tUpper, locale } = useLocale();
  const token = user?.token ?? null;
  const [stats, setStats] = useState<AdminStatsByVertical | null>(null);
  const [queries, setQueries] = useState<GapQueryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unreviewed");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  function load() {
    if (!token) return;
    return Promise.all([
      api.get<AdminStatsByVertical>("/admin/stats", token),
      api.get<GapQueryEntry[]>("/admin/gap-queries", token),
    ]).then(([statsData, gapData]) => {
      setStats(statsData);
      setQueries(gapData);
    });
  }

  useEffect(() => {
    load()?.finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filteredQueries = queries.filter((q) => {
    if (statusFilter === "unreviewed" && q.addressed) return false;
    if (statusFilter === "addressed" && !q.addressed) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      q.message.toLowerCase().includes(s) ||
      (q.company_name ?? "").toLowerCase().includes(s) ||
      (q.user_name ?? "").toLowerCase().includes(s)
    );
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
      case "user":
        return q.user_name ?? null;
      case "when":
        return parseApiDate(q.created_at).getTime();
      case "status":
        return q.addressed ? 1 : 0;
      default:
        return null;
    }
  });

  async function updateStatus(id: number, addressed: boolean) {
    const updated = await api.patch<GapQueryEntry>(`/admin/gap-queries/${id}`, { addressed }, token);
    setQueries((prev) => prev.map((q) => (q.id === id ? updated : q)));
    setOpenMenuId(null);
  }

  return (
    <div>
      <h1>{t("admin.chatGapRate.title")}</h1>
      <p className="text-muted">{t("admin.chatGapRate.description")}</p>

      {stats && (
        <p style={{ marginTop: "var(--space-2)", fontWeight: 600, color: "var(--color-danger)" }}>
          {t("admin.chatGapRate.currentRate")}: {stats.total.gap_rate}%
        </p>
      )}

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={dashStyles.sectionHeader}>
          <h2>{t("admin.chatGapRate.recentGaps")}</h2>
        </div>
        <p className="text-muted" style={{ marginBottom: "var(--space-3)" }}>
          {t("admin.chatGapRate.recentGapsHint")}
        </p>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : queries.length === 0 ? (
          <p className={dashStyles.emptyState}>{t("admin.chatGapRate.noGaps")}</p>
        ) : (
          <>
            <div className={styles.filterBar}>
              <div className={styles.searchField}>
                <input
                  className="input"
                  type="text"
                  placeholder={t("admin.chatGapRate.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <label className={styles.filterField}>
                {tUpper("admin.chatGapRate.filterStatus")}
                <select
                  className="input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                >
                  <option value="all">{t("admin.chatGapRate.filterAll")}</option>
                  <option value="unreviewed">{t("admin.chatGapRate.status.unreviewed")}</option>
                  <option value="addressed">{t("admin.chatGapRate.status.addressed")}</option>
                </select>
              </label>
            </div>
            {sortedQueries.length === 0 ? (
              <p className={dashStyles.emptyState}>{t("admin.chatGapRate.noResults")}</p>
            ) : (
              <table className={dashStyles.table}>
                <thead>
                  <tr>
                    <th>{tUpper("admin.chatGapRate.colQuestion")}</th>
                    <SortableTh label={tUpper("dash.super.colCompany")} column="company" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("admin.chatGapRate.colUser")} column="user" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("dash.super.colWhen")} column="when" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("admin.chatGapRate.colStatus")} column="status" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <th>{tUpper("admin.chatGapRate.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedQueries.map((q) => (
                    <tr key={q.id}>
                      <td>{q.message}</td>
                      <td className="text-muted">{q.company_name ?? t("dash.super.platform")}</td>
                      <td className="text-muted">{q.user_name ?? "—"}</td>
                      <td className="text-muted">{parseApiDate(q.created_at).toLocaleString(locale)}</td>
                      <td>
                        <span
                          className={`badge ${styles[q.addressed ? "status-addressed" : "status-unreviewed"]}`}
                          title={q.addressed_at ? parseApiDate(q.addressed_at).toLocaleString(locale) : undefined}
                        >
                          {t(q.addressed ? "admin.chatGapRate.status.addressed" : "admin.chatGapRate.status.unreviewed")}
                        </span>
                      </td>
                      <td className={styles.rowMenuWrap}>
                        <button
                          type="button"
                          className={styles.rowMenuButton}
                          aria-label={t("admin.chatGapRate.menuActionsFor", { id: q.id })}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === q.id}
                          onClick={() => setOpenMenuId(openMenuId === q.id ? null : q.id)}
                        >
                          ⋯
                        </button>
                        {openMenuId === q.id && (
                          <div className={styles.rowMenu} role="menu">
                            {q.addressed ? (
                              <button className={styles.rowMenuItem} onClick={() => updateStatus(q.id, false)}>
                                {t("admin.chatGapRate.markUnreviewed")}
                              </button>
                            ) : (
                              <button className={styles.rowMenuItem} onClick={() => updateStatus(q.id, true)}>
                                {t("admin.chatGapRate.markAddressed")}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
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

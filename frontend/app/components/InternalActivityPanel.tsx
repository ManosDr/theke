"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import { SortableTh } from "./SortableTh";
import { useSortableData } from "../lib/useSortableData";
import type { InternalActivityResponse } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";
import panelStyles from "./InternalActivityPanel.module.css";

export function InternalActivityPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const [data, setData] = useState<InternalActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatSearch, setChatSearch] = useState("");
  const [chatGapFilter, setChatGapFilter] = useState<"" | "yes" | "no">("");
  const [auditSearch, setAuditSearch] = useState("");

  useEffect(() => {
    if (!user?.token) return;
    api
      .get<InternalActivityResponse>("/admin/internal-activity", user.token)
      .then(setData)
      .finally(() => setLoading(false));
  }, [user?.token]);

  const filteredChatActivity = (data?.chat_activity ?? []).filter((row) => {
    if (chatSearch) {
      const q = chatSearch.toLowerCase();
      if (!row.actor_email.toLowerCase().includes(q) && !(row.message ?? "").toLowerCase().includes(q)) return false;
    }
    if (chatGapFilter === "yes" && !row.gap) return false;
    if (chatGapFilter === "no" && row.gap !== false) return false;
    return true;
  });
  const {
    sorted: sortedChatActivity,
    sortColumn: chatSortColumn,
    sortDirection: chatSortDirection,
    toggleSort: toggleChatSort,
  } = useSortableData(filteredChatActivity, (row, column) => {
    switch (column) {
      case "actor":
        return row.actor_email;
      case "when":
        return parseApiDate(row.created_at).getTime();
      default:
        return null;
    }
  });
  const hasChatFilters = Boolean(chatSearch || chatGapFilter);
  function clearChatFilters() {
    setChatSearch("");
    setChatGapFilter("");
  }

  const filteredAuditActivity = (data?.audit_activity ?? []).filter((row) => {
    if (!auditSearch) return true;
    const q = auditSearch.toLowerCase();
    return (
      row.actor_email.toLowerCase().includes(q) ||
      row.action.toLowerCase().includes(q) ||
      (row.resource_type ?? "").toLowerCase().includes(q)
    );
  });
  const {
    sorted: sortedAuditActivity,
    sortColumn: auditSortColumn,
    sortDirection: auditSortDirection,
    toggleSort: toggleAuditSort,
  } = useSortableData(filteredAuditActivity, (row, column) => {
    switch (column) {
      case "actor":
        return row.actor_email;
      case "action":
        return row.action;
      case "when":
        return parseApiDate(row.created_at).getTime();
      default:
        return null;
    }
  });

  return (
    <div>
      <h1>{t("admin.internalActivity.title")}</h1>
      <p className="text-muted">{t("admin.internalActivity.description")}</p>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.sectionHeader}>
          <h2>{t("admin.internalActivity.chatSection")}</h2>
        </div>
        <p className="text-muted" style={{ marginBottom: "var(--space-3)" }}>
          {t("admin.internalActivity.chatHint")}
        </p>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : !data || data.chat_activity.length === 0 ? (
          <p className={styles.emptyState}>{t("admin.internalActivity.noChatActivity")}</p>
        ) : (
          <>
            <div className={`card ${panelStyles.filterBar}`}>
              <input
                className={`input ${panelStyles.searchInput}`}
                type="text"
                placeholder={t("admin.internalActivity.searchPlaceholder")}
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
              />
              <select className={`input ${panelStyles.filterSelect}`} value={chatGapFilter} onChange={(e) => setChatGapFilter(e.target.value as "" | "yes" | "no")}>
                <option value="">{tUpper("admin.internalActivity.colGap")}</option>
                <option value="yes">{t("admin.internalActivity.gapYes")}</option>
                <option value="no">{t("admin.internalActivity.gapNo")}</option>
              </select>
              {hasChatFilters && (
                <button type="button" className={panelStyles.clearFilters} onClick={clearChatFilters}>
                  {t("docs.clearFilters")}
                </button>
              )}
            </div>
            {sortedChatActivity.length === 0 ? (
              <p className={styles.emptyState}>{t("chat.context.noResults")}</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <SortableTh label={tUpper("admin.internalActivity.colActor")} column="actor" activeColumn={chatSortColumn} direction={chatSortDirection} onSort={toggleChatSort} />
                    <th>{tUpper("admin.internalActivity.colMessage")}</th>
                    <th>{tUpper("admin.internalActivity.colGap")}</th>
                    <SortableTh label={tUpper("admin.internalActivity.colWhen")} column="when" activeColumn={chatSortColumn} direction={chatSortDirection} onSort={toggleChatSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedChatActivity.map((row) => (
                    <tr key={row.id}>
                      <td className="text-muted">{row.actor_email}</td>
                      <td>{row.message ?? "—"}</td>
                      <td className="text-muted">{row.gap === null ? "—" : row.gap ? "✓" : ""}</td>
                      <td className="text-muted">{parseApiDate(row.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.sectionHeader}>
          <h2>{t("admin.internalActivity.auditSection")}</h2>
        </div>
        <p className="text-muted" style={{ marginBottom: "var(--space-3)" }}>
          {t("admin.internalActivity.auditHint")}
        </p>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : !data || data.audit_activity.length === 0 ? (
          <p className={styles.emptyState}>{t("admin.internalActivity.noAuditActivity")}</p>
        ) : (
          <>
            <input
              className={`input ${panelStyles.searchInput}`}
              type="text"
              placeholder={t("admin.internalActivity.searchPlaceholder")}
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              style={{ marginBottom: "var(--space-3)", maxWidth: 320 }}
            />
            {sortedAuditActivity.length === 0 ? (
              <p className={styles.emptyState}>{t("chat.context.noResults")}</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <SortableTh label={tUpper("admin.internalActivity.colActor")} column="actor" activeColumn={auditSortColumn} direction={auditSortDirection} onSort={toggleAuditSort} />
                    <SortableTh label={tUpper("admin.internalActivity.colAction")} column="action" activeColumn={auditSortColumn} direction={auditSortDirection} onSort={toggleAuditSort} />
                    <th>{tUpper("admin.internalActivity.colResource")}</th>
                    <SortableTh label={tUpper("admin.internalActivity.colWhen")} column="when" activeColumn={auditSortColumn} direction={auditSortDirection} onSort={toggleAuditSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedAuditActivity.map((row) => (
                    <tr key={row.id}>
                      <td className="text-muted">{row.actor_email}</td>
                      <td>{row.action}</td>
                      <td className="text-muted">
                        {row.resource_type ?? "—"}
                        {row.resource_id !== null ? ` #${row.resource_id}` : ""}
                      </td>
                      <td className="text-muted">{parseApiDate(row.created_at).toLocaleString()}</td>
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

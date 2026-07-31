"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import dashStyles from "../dashboard/dashboard.module.css";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { AuditLogEntry, AuditLogListResponse, CompanySummary } from "../lib/types";
import styles from "./AuditLogPanel.module.css";

const PAGE_SIZE = 50;

// Full drill-through behind the dashboard's Audit tab "view all" link - that
// tab only ever shows the first 8 of a 200-row preview (11,500+ rows exist
// in a real deployment), so this is the only place a super admin can
// actually page through and search the complete audit trail.
export function AuditLogPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const token = user?.token ?? null;

  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");

  useEffect(() => {
    if (!token) return;
    api.get<CompanySummary[]>("/admin/companies", token).then(setCompanies);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (companyFilter) params.set("company_id", companyFilter);
    if (q.trim()) params.set("q", q.trim());
    const timer = setTimeout(() => {
      api.get<AuditLogListResponse>(`/admin/audit-log?${params.toString()}`, token).then((data) => {
        setItems(data.items);
        setTotal(data.total);
        setLoading(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [token, page, q, companyFilter]);

  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
  const hasFilters = Boolean(q || companyFilter);
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <h1>{t("adminAuditLog.title")}</h1>
      <p className="text-muted" style={{ marginTop: 0 }}>
        {t("adminAuditLog.description")}
      </p>

      <div className={styles.filterBar}>
        <input
          className={`input ${styles.searchInput}`}
          type="text"
          placeholder={t("adminAuditLog.searchPlaceholder")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <select
          className="input"
          value={companyFilter}
          onChange={(e) => {
            setCompanyFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("adminAuditLog.filterCompany")}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            className={styles.clearFilters}
            onClick={() => {
              setQ("");
              setCompanyFilter("");
              setPage(0);
            }}
          >
            {t("docs.clearFilters")}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className={dashStyles.emptyState}>{hasFilters ? t("common.noMatches") : t("dash.super.noActivity")}</p>
      ) : (
        <>
          <table className={dashStyles.table}>
            <thead>
              <tr>
                <th>{tUpper("dash.super.colAction")}</th>
                <th>{tUpper("dash.super.colCompany")}</th>
                <th>{tUpper("dash.super.colResource")}</th>
                <th>{tUpper("adminAuditLog.colActor")}</th>
                <th>{tUpper("dash.super.colWhen")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.action}</td>
                  <td className="text-muted">
                    {entry.company_id ? (companyNameById.get(entry.company_id) ?? `#${entry.company_id}`) : t("dash.super.platform")}
                  </td>
                  <td className="text-muted">
                    {entry.resource_type
                      ? `${entry.resource_type}${entry.resource_id != null ? ` #${entry.resource_id}` : ""}`
                      : "—"}
                  </td>
                  <td className="text-muted">{entry.actor_user_id ?? "—"}</td>
                  <td className="text-muted">{new Date(entry.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.pagination}>
            <button type="button" className="btn btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              {t("adminAuditLog.prev")}
            </button>
            <span className="text-muted">{t("adminAuditLog.showingRange", { from, to, total })}</span>
            <button type="button" className="btn btn-secondary" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
              {t("adminAuditLog.next")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

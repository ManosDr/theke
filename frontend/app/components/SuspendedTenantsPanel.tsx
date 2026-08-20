"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import { SortableTh } from "./SortableTh";
import type { TranslationKey } from "../lib/translations";
import { useSortableData } from "../lib/useSortableData";
import type { CompanySummary } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";
import panelStyles from "./SuspendedTenantsPanel.module.css";

const COMPANY_TYPE_KEYS: Record<string, TranslationKey> = {
  construction: "register.typeConstruction",
  municipality: "register.typeMunicipality",
};

export function SuspendedTenantsPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "active" | "suspended">("");

  function refresh() {
    if (!user?.token) return;
    api
      .get<CompanySummary[]>("/admin/companies", user.token)
      // Suspended-first is still the natural default view for a screen whose
      // whole purpose is surfacing suspended tenants - but this is now just
      // the starting order, not a fixed sort: every column below is
      // user-sortable via SortableTh, and a header click overrides it.
      .then((data) => setCompanies([...data].sort((a, b) => Number(b.is_suspended) - Number(a.is_suspended))))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [user?.token]);

  async function toggleSuspend(company: CompanySummary) {
    const action = company.is_suspended ? "unsuspend" : "suspend";
    await api.post(`/admin/companies/${company.id}/${action}`, undefined, user?.token ?? null);
    refresh();
  }

  const suspendedCount = companies.filter((c) => c.is_suspended).length;

  const hasFilters = Boolean(search || filterType || filterStatus);
  function clearFilters() {
    setSearch("");
    setFilterType("");
    setFilterStatus("");
  }

  const filteredCompanies = companies.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType && c.type !== filterType) return false;
    if (filterStatus === "active" && c.is_suspended) return false;
    if (filterStatus === "suspended" && !c.is_suspended) return false;
    return true;
  });

  const {
    sorted: sortedCompanies,
    sortColumn,
    sortDirection,
    toggleSort,
  } = useSortableData(filteredCompanies, (c, column) => {
    switch (column) {
      case "name":
        return c.name;
      case "type":
        return c.type;
      case "status":
        return c.is_suspended ? 1 : 0;
      case "created":
        return parseApiDate(c.created_at).getTime();
      default:
        return null;
    }
  });

  return (
    <div>
      <h1>{t("admin.suspendedTenants.title")}</h1>
      <p className="text-muted">{t("admin.suspendedTenants.description")}</p>
      <p style={{ marginTop: "var(--space-2)", fontWeight: 600, color: suspendedCount > 0 ? "var(--color-danger)" : "var(--color-primary)" }}>
        {t("admin.suspendedTenants.currentlySuspended", { count: suspendedCount })}
      </p>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.super.companies")}</h2>
          <span className="text-muted">{t("dash.super.companiesTotal", { count: companies.length })}</span>
        </div>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : companies.length === 0 ? (
          <p className={styles.emptyState}>{t("dash.super.noCompanies")}</p>
        ) : (
          <>
            <div className={`card ${panelStyles.filterBar}`}>
              <input
                className={`input ${panelStyles.searchInput}`}
                type="text"
                placeholder={t("companies.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select className={`input ${panelStyles.filterSelect}`} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">{tUpper("dash.super.colType")}</option>
                <option value="construction">{t("register.typeConstruction")}</option>
                <option value="municipality">{t("register.typeMunicipality")}</option>
              </select>
              <select
                className={`input ${panelStyles.filterSelect}`}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as "" | "active" | "suspended")}
              >
                <option value="">{tUpper("dash.super.colStatus")}</option>
                <option value="active">{t("dash.super.statusActive")}</option>
                <option value="suspended">{t("dash.super.statusSuspended")}</option>
              </select>
              {hasFilters && (
                <button type="button" className={panelStyles.clearFilters} onClick={clearFilters}>
                  {t("docs.clearFilters")}
                </button>
              )}
            </div>

            {sortedCompanies.length === 0 ? (
              <p className={styles.emptyState}>{t("chat.context.noResults")}</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <SortableTh label={tUpper("dash.super.colName")} column="name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("dash.super.colType")} column="type" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("dash.super.colStatus")} column="status" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("dash.super.colCreated")} column="created" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCompanies.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{COMPANY_TYPE_KEYS[c.type] ? t(COMPANY_TYPE_KEYS[c.type]) : c.type}</td>
                      <td>
                        <span className={`badge ${c.is_suspended ? "badge-danger" : "badge-success"}`}>
                          {c.is_suspended ? t("dash.super.statusSuspended") : t("dash.super.statusActive")}
                        </span>
                      </td>
                      <td className="text-muted">{parseApiDate(c.created_at).toLocaleDateString()}</td>
                      <td>
                        <button className="btn btn-secondary" onClick={() => toggleSuspend(c)}>
                          {c.is_suspended ? t("dash.super.unsuspend") : t("dash.super.suspend")}
                        </button>
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

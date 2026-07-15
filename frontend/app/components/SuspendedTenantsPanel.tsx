"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { CompanySummary } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";

const COMPANY_TYPE_KEYS: Record<string, TranslationKey> = {
  construction: "register.typeConstruction",
  municipality: "register.typeMunicipality",
};

export function SuspendedTenantsPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);

  function refresh() {
    if (!user?.token) return;
    api
      .get<CompanySummary[]>("/admin/companies", user.token)
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
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{tUpper("dash.super.colName")}</th>
                <th>{tUpper("dash.super.colType")}</th>
                <th>{tUpper("dash.super.colStatus")}</th>
                <th>{tUpper("dash.super.colCreated")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{COMPANY_TYPE_KEYS[c.type] ? t(COMPANY_TYPE_KEYS[c.type]) : c.type}</td>
                  <td>
                    <span className={`badge ${c.is_suspended ? "badge-danger" : "badge-success"}`}>
                      {c.is_suspended ? t("dash.super.statusSuspended") : t("dash.super.statusActive")}
                    </span>
                  </td>
                  <td className="text-muted">{new Date(c.created_at).toLocaleDateString()}</td>
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
      </section>
    </div>
  );
}

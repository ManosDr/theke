"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { ApiError, api } from "../../lib/api";
import { RequireAuth, useAuth } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";
import type { CustomerDetailResponse } from "../../lib/types";
import dashboardStyles from "../../dashboard/dashboard.module.css";
import styles from "./page.module.css";

function CustomerDetailContent() {
  const { user } = useAuth();
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const token = user?.token ?? null;

  const [customer, setCustomer] = useState<CustomerDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<CustomerDetailResponse>(`/customers/${params.id}`, token)
      .then(setCustomer)
      .catch((err) => setError(err instanceof ApiError ? err.message : t("customer.detailNotFound")));
  }, [params.id, token, t]);

  if (error) return <p>{error}</p>;
  if (!customer) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <h1>{customer.name}</h1>

      <div className="card" style={{ padding: "var(--space-4)", marginBottom: "var(--space-4)" }}>
        <dl className={styles.metaGrid}>
          <dt>{t("customer.afm")}</dt>
          <dd>{customer.afm ?? "—"}</dd>
          <dt>{t("customer.phone")}</dt>
          <dd>{customer.phone ?? "—"}</dd>
          <dt>{t("customer.email")}</dt>
          <dd>{customer.email ?? "—"}</dd>
          {customer.notes && (
            <>
              <dt>{t("dash.member.colClientNotes")}</dt>
              <dd>{customer.notes}</dd>
            </>
          )}
        </dl>
      </div>

      <section className={`card ${dashboardStyles.section}`}>
        <h2>{t("customer.detailProjects")}</h2>
        {customer.projects.length === 0 ? (
          <p className={dashboardStyles.emptyState}>{t("customer.detailNoProjects")}</p>
        ) : (
          <table className={dashboardStyles.table}>
            <thead>
              <tr>
                <th>{t("dash.member.colName")}</th>
                <th>{t("dash.member.colMunicipality")}</th>
              </tr>
            </thead>
            <tbody>
              {customer.projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.name}</Link>
                  </td>
                  <td>{p.region_name_el ?? t("project.detail.customer")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Link href="/dashboard" className={styles.backLink}>
        {t("customer.backToDashboard")}
      </Link>
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <RequireAuth>
      <AppShell>
        <CustomerDetailContent />
      </AppShell>
    </RequireAuth>
  );
}

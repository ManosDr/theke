"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { InternalActivityResponse } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";

export function InternalActivityPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const [data, setData] = useState<InternalActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.token) return;
    api
      .get<InternalActivityResponse>("/admin/internal-activity", user.token)
      .then(setData)
      .finally(() => setLoading(false));
  }, [user?.token]);

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
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{tUpper("admin.internalActivity.colActor")}</th>
                <th>{tUpper("admin.internalActivity.colMessage")}</th>
                <th>{tUpper("admin.internalActivity.colGap")}</th>
                <th>{tUpper("admin.internalActivity.colWhen")}</th>
              </tr>
            </thead>
            <tbody>
              {data.chat_activity.map((row) => (
                <tr key={row.id}>
                  <td className="text-muted">{row.actor_email}</td>
                  <td>{row.message ?? "—"}</td>
                  <td className="text-muted">{row.gap === null ? "—" : row.gap ? "✓" : ""}</td>
                  <td className="text-muted">{new Date(row.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{tUpper("admin.internalActivity.colActor")}</th>
                <th>{tUpper("admin.internalActivity.colAction")}</th>
                <th>{tUpper("admin.internalActivity.colResource")}</th>
                <th>{tUpper("admin.internalActivity.colWhen")}</th>
              </tr>
            </thead>
            <tbody>
              {data.audit_activity.map((row) => (
                <tr key={row.id}>
                  <td className="text-muted">{row.actor_email}</td>
                  <td>{row.action}</td>
                  <td className="text-muted">
                    {row.resource_type ?? "—"}
                    {row.resource_id !== null ? ` #${row.resource_id}` : ""}
                  </td>
                  <td className="text-muted">{new Date(row.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

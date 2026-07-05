"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { StaleDocumentSummary } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";

// Backs both /admin/stale-documents and /admin/needs-review: there is only
// one backend queue (GET /admin/stale-documents), not two - the weekly
// staleness sweep flags documents.needs_review itself rather than
// maintaining a separate flag (see crawler/crawler/staleness.py), so a
// document that needs review IS the stale-documents list, not a different
// one. Two routes exist because both were asked for; they show the same
// data rather than pretending a second, distinct queue exists.
export function StaleDocumentsQueue({ title, description }: { title: string; description: string }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const [docs, setDocs] = useState<StaleDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.token) return;
    api
      .get<StaleDocumentSummary[]>("/admin/stale-documents", user.token)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [user?.token]);

  return (
    <div>
      <h1>{title}</h1>
      <p className="text-muted">{description}</p>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : docs.length === 0 ? (
          <p className={styles.emptyState}>{t("dash.super.noStaleDocs")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("dash.super.colTitle")}</th>
                <th>{t("dash.super.colSource")}</th>
                <th>{t("dash.super.colRegion")}</th>
                <th>{t("dash.super.colLastVerified")}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.title}</td>
                  <td className="text-muted">{doc.source_group ?? "—"}</td>
                  <td className="text-muted">{doc.region_id ?? t("dash.super.national")}</td>
                  <td>
                    <span className="badge badge-warning">
                      {doc.last_verified_at ? new Date(doc.last_verified_at).toLocaleDateString() : t("dash.super.neverVerified")}
                    </span>
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

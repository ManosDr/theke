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
  const { t, tUpper } = useLocale();
  const [docs, setDocs] = useState<StaleDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<number | null>(null);
  // Per-row confirmation gate: clearing needs_review can't itself verify the
  // content was fixed (confirmed the hard way - an uncorrected document
  // became fully visible in chat/search the moment its flag was cleared),
  // so the button stays disabled until the reviewer explicitly checks this.
  const [confirmedIds, setConfirmedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!user?.token) return;
    api
      .get<StaleDocumentSummary[]>("/admin/stale-documents", user.token)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [user?.token]);

  function toggleConfirmed(id: number, checked: boolean) {
    setConfirmedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function markReviewed(id: number) {
    if (!user?.token || !confirmedIds.has(id)) return;
    setMarkingId(id);
    try {
      await api.post(`/admin/stale-documents/${id}/mark-reviewed`, { confirmed: true }, user.token);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setMarkingId(null);
    }
  }

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
                <th>{tUpper("dash.super.colTitle")}</th>
                <th>{tUpper("dash.super.colSource")}</th>
                <th>{tUpper("dash.super.colRegion")}</th>
                <th>{tUpper("dash.super.colLastVerified")}</th>
                <th>{tUpper("admin.confirmCorrect")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    {doc.title}
                    {doc.auto_needs_review_reason && (
                      <div className="text-muted" style={{ fontSize: "0.8rem", color: "var(--admin-warning)" }}>
                        {t("docs.autoFlaggedLabel")} {doc.auto_needs_review_reason}
                      </div>
                    )}
                  </td>
                  <td className="text-muted">{doc.source_group ?? "—"}</td>
                  <td className="text-muted">{doc.region_id ?? t("dash.super.national")}</td>
                  <td>
                    <span className="badge badge-warning">
                      {doc.last_verified_at ? new Date(doc.last_verified_at).toLocaleDateString() : t("dash.super.neverVerified")}
                    </span>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={confirmedIds.has(doc.id)}
                      onChange={(e) => toggleConfirmed(doc.id, e.target.checked)}
                      aria-label={t("admin.confirmCorrect")}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={markingId === doc.id || !confirmedIds.has(doc.id)}
                      onClick={() => markReviewed(doc.id)}
                    >
                      {markingId === doc.id ? t("admin.marking") : t("admin.markReviewed")}
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

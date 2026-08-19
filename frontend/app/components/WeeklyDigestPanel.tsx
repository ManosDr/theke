"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import type { WeeklyDigestEntry, WeeklyDigestsResponse } from "../lib/types";
import styles from "../dashboard/dashboard.module.css";

export function WeeklyDigestPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const [data, setData] = useState<WeeklyDigestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  function load() {
    if (!user?.token) return;
    return api.get<WeeklyDigestsResponse>("/admin/digests", user.token).then(setData);
  }

  useEffect(() => {
    load()?.finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token]);

  async function handleResend() {
    if (!user?.token) return;
    setResendMessage(null);
    setResendError(null);
    setResending(true);
    try {
      const entry = await api.post<WeeklyDigestEntry>("/admin/digests/resend", {}, user.token);
      await load();
      setResendMessage(t("admin.digest.resent", { count: String(entry.recipients_sent) }));
    } catch (err) {
      setResendError(err instanceof ApiError ? err.message : t("admin.digest.resendFailed"));
    } finally {
      setResending(false);
    }
  }

  return (
    <div>
      <h1>{t("admin.digest.title")}</h1>
      <p className="text-muted">{t("admin.digest.description")}</p>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--space-3)" }}>
          <h3 style={{ margin: 0 }}>{t("admin.digest.latestTitle")}</h3>
          <button type="button" className="btn btn-primary" disabled={resending} onClick={handleResend}>
            {resending ? t("admin.digest.resending") : t("admin.digest.resendNow")}
          </button>
        </div>
        {resendMessage && (
          <p className="text-muted" style={{ color: "var(--color-success)", marginBottom: 0 }}>
            {resendMessage}
          </p>
        )}
        {resendError && (
          <p className="text-muted" style={{ color: "var(--color-danger)", marginBottom: 0 }}>
            {resendError}
          </p>
        )}

        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : !data?.latest ? (
          <p className={styles.emptyState}>{t("admin.digest.noData")}</p>
        ) : (
          <div className={styles.kbHealthStats} style={{ marginTop: "var(--space-3)" }}>
            <div>
              <span className={styles.value}>{data.latest.total_messages.toLocaleString()}</span>
              <span className={styles.label}>{t("admin.digest.colMessages")}</span>
            </div>
            <div>
              <span className={styles.value}>{data.latest.gap_rate}%</span>
              <span className={styles.label}>{t("admin.digest.colGapRate")}</span>
            </div>
            <div>
              <span className={styles.value}>€{data.latest.spend_7d_eur.toFixed(2)}</span>
              <span className={styles.label}>{t("admin.digest.colSpend")}</span>
            </div>
            <div>
              <span className={styles.value}>{data.latest.active_companies}</span>
              <span className={styles.label}>{t("admin.digest.colActiveCompanies")}</span>
            </div>
            <div>
              <span className={styles.value}>{data.latest.open_feedback}</span>
              <span className={styles.label}>{t("admin.digest.colFeedback")}</span>
            </div>
            <div>
              <span className={styles.value}>{data.latest.needs_review}</span>
              <span className={styles.label}>{t("admin.digest.colNeedsReview")}</span>
            </div>
          </div>
        )}
        {data?.latest && (
          <p className="text-muted" style={{ marginTop: "var(--space-3)", marginBottom: 0 }}>
            {t("admin.digest.sentAt", {
              date: parseApiDate(data.latest.created_at).toLocaleString(),
              sent: String(data.latest.recipients_sent),
              total: String(data.latest.recipients_total),
            })}
          </p>
        )}
      </section>

      {data?.history && data.history.length > 0 && (
        <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
          <div style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{tUpper("admin.digest.colDate")}</th>
                  <th>{tUpper("admin.digest.colMessages")}</th>
                  <th>{tUpper("admin.digest.colGapRate")}</th>
                  <th>{tUpper("admin.digest.colSpend")}</th>
                  <th>{tUpper("admin.digest.colRecipients")}</th>
                  <th>{tUpper("admin.digest.colTrigger")}</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.created_at}>
                    <td className="text-muted">{parseApiDate(h.created_at).toLocaleString()}</td>
                    <td>{h.total_messages.toLocaleString()}</td>
                    <td>{h.gap_rate}%</td>
                    <td>€{h.spend_7d_eur.toFixed(2)}</td>
                    <td>
                      {h.recipients_sent}/{h.recipients_total}
                    </td>
                    <td className="text-muted">
                      {h.triggered_manually ? t("admin.digest.triggerManual") : t("admin.digest.triggerScheduled")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

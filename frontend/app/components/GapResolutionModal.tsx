"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import type { GapDiscoveryResult, GapSourceCandidateEntry } from "../lib/types";
import { ConfidenceBadge } from "./ConfidenceBadge";
import styles from "./GapResolutionModal.module.css";

type ModalState = "searching" | "not_found" | "reviewing" | "confirmed_choice" | "error";

// Part E of the same-night batch: the whole search -> review -> confirm ->
// notify/don't-notify flow, in one modal that opens wherever the admin
// currently is in a long gap list - previously "discover source" wrote its
// result into a section at the very top of the page, several screens above
// a row deep in the table, forcing a scroll back up to see anything happen.
// Also opens directly into the notify/don't-notify choice for an already-
// confirmed candidate that's still awaiting that decision (existingCandidate)
// - the same choice this component exists to offer, just entered from a
// different starting point, not a second implementation of it.
export function GapResolutionModal({
  query,
  existingCandidate,
  token,
  onClose,
  onResolved,
}: {
  query: { id: number; message: string };
  existingCandidate?: GapSourceCandidateEntry | null;
  token: string | null;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { t, locale } = useLocale();
  // existingCandidate covers two entry points now: a confirmed candidate
  // still awaiting its notify/don't-notify decision (-> confirmed_choice,
  // the original case), or a pending_review candidate someone else already
  // discovered - e.g. "Επανέλεγχος όλων"'s external-search fallback, staged
  // in the background with no modal open at the time (-> reviewing, same
  // state a fresh manual search lands in, just skipping the search() call
  // since a candidate already exists).
  const [state, setState] = useState<ModalState>(
    existingCandidate ? (existingCandidate.status === "confirmed" ? "confirmed_choice" : "reviewing") : "searching"
  );
  const [candidate, setCandidate] = useState<GapSourceCandidateEntry | null>(existingCandidate ?? null);
  const [title, setTitle] = useState(existingCandidate?.candidate_title ?? "");
  const [content, setContent] = useState(existingCandidate?.candidate_content ?? "");
  const [sourceUrl, setSourceUrl] = useState(existingCandidate?.source_url ?? "");
  const [authority, setAuthority] = useState(existingCandidate?.authority ?? "");
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectNote, setShowRejectNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existingCandidate) return;
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search() {
    if (!token) return;
    setState("searching");
    setError(null);
    try {
      const result = await api.post<GapDiscoveryResult>(`/admin/gap-queries/${query.id}/discover-source`, {}, token);
      if (result.candidate) {
        setCandidate(result.candidate);
        setTitle(result.candidate.candidate_title ?? "");
        setContent(result.candidate.candidate_content ?? "");
        setSourceUrl(result.candidate.source_url);
        setAuthority(result.candidate.authority ?? "");
        setState("reviewing");
      } else {
        setState("not_found");
      }
    } catch {
      setError(t("admin.chatGapRate.candidates.searchFailed"));
      setState("error");
    }
  }

  async function confirm() {
    if (!token || !candidate) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<GapSourceCandidateEntry>(
        `/admin/gap-source-candidates/${candidate.id}/confirm`,
        { title, content, source_url: sourceUrl, authority: authority || null },
        token
      );
      setCandidate(updated);
      setState("confirmed_choice");
      // Confirming already changed real state (a live Document, and the
      // originating gap's addressed flag - see the confirm endpoint) even
      // though this modal stays open for the separate notify decision, so
      // the page behind it (the "Πρόσφατες αναπάντητες ερωτήσεις" table,
      // the candidate lists) should reflect that now, not only once the
      // modal eventually closes after notify/skip.
      onResolved();
    } catch {
      setError(t("admin.chatGapRate.candidates.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!token || !candidate) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/gap-source-candidates/${candidate.id}/reject`, { review_note: rejectNote || null }, token);
      onResolved();
      onClose();
    } catch {
      setError(t("admin.chatGapRate.candidates.actionFailed"));
      setBusy(false);
    }
  }

  async function notifyUser(sendEmail: boolean) {
    if (!token || !candidate) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/gap-source-candidates/${candidate.id}/notify-user`, { send_email: sendEmail }, token);
      onResolved();
      onClose();
    } catch {
      setError(t("admin.chatGapRate.candidates.actionFailed"));
      setBusy(false);
    }
  }

  async function skipNotify() {
    if (!token || !candidate) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/gap-source-candidates/${candidate.id}/skip-notify`, {}, token);
      onResolved();
      onClose();
    } catch {
      setError(t("admin.chatGapRate.candidates.actionFailed"));
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="gap-resolution-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 id="gap-resolution-title" style={{ margin: 0 }}>
            {t("admin.chatGapRate.candidates.modalTitle")}
          </h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>

        <p className={styles.question}>{query.message}</p>

        {(state === "searching" || state === "not_found" || state === "error") && (
          <div className={styles.centeredStatus}>
            {state === "searching" && <p>{t("admin.chatGapRate.candidates.searching")}</p>}
            {state === "not_found" && <p>{t("admin.chatGapRate.candidates.foundNone")}</p>}
            {state === "error" && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
          </div>
        )}

        {state === "reviewing" && candidate && (
          <>
            {candidate.confidence && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <ConfidenceBadge confidence={candidate.confidence} />
              </div>
            )}
            {candidate.prior_rejections.length > 0 && (
              <div className={styles.priorRejectionBox}>
                {candidate.prior_rejections.map((r) => (
                  <p key={r.id}>
                    {t("admin.chatGapRate.candidates.priorRejection", {
                      date: r.reviewed_at ? parseApiDate(r.reviewed_at).toLocaleDateString(locale) : "",
                    })}
                    {r.review_note ? `: ${r.review_note}` : ""}
                  </p>
                ))}
              </div>
            )}
            <label className={styles.field}>
              {t("admin.chatGapRate.candidates.fieldTitle")}
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className={styles.field}>
              {t("admin.chatGapRate.candidates.fieldContent")}
              <textarea className="input" rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
            </label>
            <label className={styles.field}>
              {t("admin.chatGapRate.candidates.fieldSourceUrl")}
              <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
            </label>
            <label className={styles.field}>
              {t("admin.chatGapRate.candidates.fieldAuthority")}
              <input className="input" value={authority} onChange={(e) => setAuthority(e.target.value)} />
            </label>
            {error && <p style={{ color: "var(--color-danger)", fontSize: "0.82rem" }}>{error}</p>}
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
                {t("admin.chatGapRate.candidates.confirm")}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setShowRejectNote((v) => !v)}>
                {t("admin.chatGapRate.candidates.reject")}
              </button>
            </div>
            {showRejectNote && (
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                <input
                  className="input"
                  placeholder={t("admin.chatGapRate.candidates.rejectNotePlaceholder")}
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                />
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={reject}>
                  {t("admin.chatGapRate.candidates.confirmReject")}
                </button>
              </div>
            )}
          </>
        )}

        {state === "confirmed_choice" && candidate && (
          <div className={styles.choiceBlock}>
            {candidate.confidence && <ConfidenceBadge confidence={candidate.confidence} />}
            <p className="text-muted">{t("admin.chatGapRate.candidates.postConfirmHint")}</p>
            {error && <p style={{ color: "var(--color-danger)", fontSize: "0.82rem" }}>{error}</p>}
            <div className={styles.choiceButtons}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => notifyUser(true)}>
                {t("admin.chatGapRate.candidates.notifyUser")}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => notifyUser(false)}>
                {t("admin.chatGapRate.candidates.notifyUserInAppOnly")}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={skipNotify}>
                {t("admin.chatGapRate.candidates.skipNotify")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

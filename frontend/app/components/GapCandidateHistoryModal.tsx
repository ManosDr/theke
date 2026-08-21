"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import type { GapSourceCandidateEntry } from "../lib/types";
import { ConfidenceBadge } from "./ConfidenceBadge";
import styles from "./GapCandidateHistoryModal.module.css";

const STATUS_BADGE_CLASS: Record<string, string> = {
  confirmed: "badge-success",
  rejected: "badge-danger",
  pending_review: "badge-warning",
};

const STATUS_LABEL_KEY: Record<string, "admin.chatGapRate.history.statusConfirmed" | "admin.chatGapRate.history.statusRejected" | "admin.chatGapRate.history.statusPending"> = {
  confirmed: "admin.chatGapRate.history.statusConfirmed",
  rejected: "admin.chatGapRate.history.statusRejected",
  pending_review: "admin.chatGapRate.history.statusPending",
};

// Read-only history for one gap's full candidate trail - every source ever
// discovered/proposed for this question, confirmed or rejected, stays real
// and reachable here even after the gap itself is resolved and its
// pending_review candidates drop out of the active "Χρειάζεται έλεγχο
// πηγής" queue (see GET /admin/gap-source-candidates's own comment on why
// that exclusion exists). No actions here on purpose - Confirm/Reject/
// notify only ever happen from the active queue via GapResolutionModal,
// this is purely "what happened and why," kept as evidence even for a
// rejected candidate's own reasoning.
export function GapCandidateHistoryModal({
  sessionId,
  question,
  token,
  onClose,
}: {
  sessionId: number;
  question: string;
  token: string | null;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const [candidates, setCandidates] = useState<GapSourceCandidateEntry[] | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<GapSourceCandidateEntry[]>(`/admin/gap-source-candidates?status=all&chat_session_id=${sessionId}`, token)
      .then(setCandidates);
  }, [token, sessionId]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="gap-history-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 id="gap-history-title" style={{ margin: 0 }}>
            {t("admin.chatGapRate.history.title")}
          </h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <p className={styles.question}>{question}</p>

        {candidates === null ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : candidates.length === 0 ? (
          <p className="text-muted">{t("admin.chatGapRate.history.empty")}</p>
        ) : (
          <div className={styles.list}>
            {candidates.map((c) => (
              <div key={c.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={`badge ${STATUS_BADGE_CLASS[c.status] ?? "badge-warning"}`}>
                    {t(STATUS_LABEL_KEY[c.status] ?? "admin.chatGapRate.history.statusPending")}
                  </span>
                  {c.confidence && <ConfidenceBadge confidence={c.confidence} size="sm" />}
                  <span className="text-muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
                    {parseApiDate(c.discovered_at).toLocaleDateString(locale)}
                  </span>
                </div>
                <a href={c.source_url} target="_blank" rel="noreferrer" className={styles.itemUrl}>
                  {c.source_url}
                </a>
                {c.status === "rejected" && c.review_note && (
                  <p className={styles.rejectNote}>{c.review_note}</p>
                )}
                {c.status === "confirmed" && (
                  <p className={styles.confirmedNote}>
                    {t("admin.chatGapRate.history.liveInKb")}
                    {c.notified_at
                      ? ` — ${t("admin.chatGapRate.history.notified")}`
                      : c.notify_skipped_at
                        ? ` — ${t("admin.chatGapRate.history.notifySkipped")}`
                        : ` — ${t("admin.chatGapRate.history.notifyPending")}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

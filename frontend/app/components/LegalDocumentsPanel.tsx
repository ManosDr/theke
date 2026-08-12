"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { LegalDocSlug, LegalDocumentAdminDetail, LegalDocumentAdminSummary } from "../lib/types";
import styles from "./LegalDocumentsPanel.module.css";

// Same regex as the backend's legal_docs.py find_placeholders() - used
// here only for live-typing feedback in the editor; the authoritative
// count/list always comes from the server response after Save.
const PLACEHOLDER_RE = /\[[^\]]+\](?!\()/g;

function livePlaceholders(content: string): string[] {
  return content.match(PLACEHOLDER_RE) ?? [];
}

export function LegalDocumentsPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [docs, setDocs] = useState<LegalDocumentAdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LegalDocumentAdminDetail | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishBlockers, setPublishBlockers] = useState<string[] | null>(null);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function refreshList() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.get<LegalDocumentAdminSummary[]>("/admin/legal-documents", token);
      setDocs(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function openDoc(slug: LegalDocSlug) {
    if (!token) return;
    setError(null);
    setPublishBlockers(null);
    setSavedMessage(null);
    setConfirmingUnpublish(false);
    const data = await api.get<LegalDocumentAdminDetail>(`/admin/legal-documents/${slug}`, token);
    setSelected(data);
    setEditTitle(data.title);
    setEditContent(data.content);
  }

  function close() {
    setSelected(null);
    setError(null);
    setPublishBlockers(null);
    setConfirmingUnpublish(false);
  }

  async function save() {
    if (!token || !selected) return;
    setBusy(true);
    setError(null);
    setSavedMessage(null);
    try {
      const data = await api.patch<LegalDocumentAdminDetail>(
        `/admin/legal-documents/${selected.slug}`,
        { title: editTitle, content: editContent },
        token
      );
      setSelected(data);
      setPublishBlockers(null);
      setSavedMessage(t("adminLegal.saved"));
      await refreshList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!token || !selected) return;
    setBusy(true);
    setError(null);
    setSavedMessage(null);
    try {
      // Always save first, so Δημοσίευση publishes exactly what's in the
      // editor, not a stale server-side copy from the last Save click.
      const saved = await api.patch<LegalDocumentAdminDetail>(
        `/admin/legal-documents/${selected.slug}`,
        { title: editTitle, content: editContent },
        token
      );
      if (saved.placeholders.length > 0) {
        setSelected(saved);
        setPublishBlockers(saved.placeholders);
        return;
      }
      const data = await api.post<LegalDocumentAdminDetail>(`/admin/legal-documents/${selected.slug}/publish`, undefined, token);
      setSelected(data);
      setPublishBlockers(null);
      setSavedMessage(t("adminLegal.published"));
      await refreshList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!token || !selected) return;
    setBusy(true);
    setError(null);
    setSavedMessage(null);
    try {
      const data = await api.post<LegalDocumentAdminDetail>(
        `/admin/legal-documents/${selected.slug}/unpublish`,
        { confirmed: true },
        token
      );
      setSelected(data);
      setConfirmingUnpublish(false);
      setSavedMessage(t("adminLegal.unpublished"));
      await refreshList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const editingPlaceholders = livePlaceholders(editContent);

  return (
    <div>
      <h1>{t("adminLegal.title")}</h1>
      <p className="text-muted">{t("adminLegal.subtitle")}</p>

      {loading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : (
        <div className={styles.cardGrid}>
          {docs.map((doc) => (
            <button key={doc.slug} type="button" className={styles.card} onClick={() => openDoc(doc.slug)}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>{doc.title}</span>
                <span className={doc.is_published ? styles.badgePublished : styles.badgeDraft}>
                  {doc.is_published ? t("adminLegal.published") : t("adminLegal.draft")}
                </span>
              </div>
              <div className={styles.cardMeta}>
                {t("adminLegal.version", { version: doc.version })}
                {" · "}
                {doc.placeholder_count > 0
                  ? t("adminLegal.placeholdersRemaining", { count: doc.placeholder_count })
                  : t("adminLegal.noPlaceholders")}
              </div>
              {doc.updated_by_name && (
                <div className={styles.cardMeta}>{t("adminLegal.updatedBy", { name: doc.updated_by_name })}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className={styles.editor}>
          <div className={styles.editorHeader}>
            <h2>{selected.title}</h2>
            <button type="button" className="btn btn-secondary" onClick={close}>
              {t("common.close")}
            </button>
          </div>

          <label className={styles.label}>{t("adminLegal.titleLabel")}</label>
          <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />

          <label className={styles.label}>{t("adminLegal.contentLabel")}</label>
          <textarea
            className={`input ${styles.contentArea}`}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={20}
          />

          <div className={styles.placeholderCount}>
            {editingPlaceholders.length > 0
              ? t("adminLegal.placeholdersRemaining", { count: editingPlaceholders.length })
              : t("adminLegal.noPlaceholders")}
          </div>

          {publishBlockers && publishBlockers.length > 0 && (
            <div className={styles.blockError}>
              <strong>{t("adminLegal.publishBlocked")}</strong>
              <ul>
                {publishBlockers.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className={styles.blockError}>{error}</div>}
          {savedMessage && <div className={styles.savedMessage}>{savedMessage}</div>}

          <div className={styles.actions}>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={save}>
              {t("adminLegal.save")}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
              {t("adminLegal.publish")}
            </button>
            {selected.is_published && !confirmingUnpublish && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirmingUnpublish(true)}
              >
                {t("adminLegal.unpublish")}
              </button>
            )}
            {confirmingUnpublish && (
              <>
                <span className={styles.confirmText}>{t("adminLegal.confirmUnpublish")}</span>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={unpublish}>
                  {t("adminLegal.confirmUnpublishButton")}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmingUnpublish(false)}>
                  {t("common.cancel")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

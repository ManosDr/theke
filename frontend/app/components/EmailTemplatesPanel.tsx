"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { EmailTemplateDetail, EmailTemplateKey, EmailTemplateSummary } from "../lib/types";
import styles from "./EmailTemplatesPanel.module.css";

const KEY_LABEL_KEY: Record<EmailTemplateKey, TranslationKey> = {
  invite: "adminEmailTemplates.keyInvite",
  welcome: "adminEmailTemplates.keyWelcome",
  password_reset: "adminEmailTemplates.keyPasswordReset",
};

export function EmailTemplatesPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [templates, setTemplates] = useState<EmailTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EmailTemplateDetail | null>(null);
  const [subjectEl, setSubjectEl] = useState("");
  const [subjectEn, setSubjectEn] = useState("");
  const [bodyEl, setBodyEl] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function refreshList() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.get<EmailTemplateSummary[]>("/admin/email-templates", token);
      setTemplates(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function openTemplate(key: EmailTemplateKey) {
    if (!token) return;
    setError(null);
    setSavedMessage(null);
    const data = await api.get<EmailTemplateDetail>(`/admin/email-templates/${key}`, token);
    setSelected(data);
    setSubjectEl(data.subject_el);
    setSubjectEn(data.subject_en);
    setBodyEl(data.body_el);
    setBodyEn(data.body_en);
  }

  function close() {
    setSelected(null);
    setError(null);
    setSavedMessage(null);
  }

  async function save() {
    if (!token || !selected) return;
    setBusy(true);
    setError(null);
    setSavedMessage(null);
    try {
      const data = await api.patch<EmailTemplateDetail>(
        `/admin/email-templates/${selected.template_key}`,
        { subject_el: subjectEl, subject_en: subjectEn, body_el: bodyEl, body_en: bodyEn },
        token
      );
      setSelected(data);
      setSavedMessage(t("adminEmailTemplates.saved"));
      await refreshList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>{t("adminEmailTemplates.title")}</h1>
      <p className="text-muted">{t("adminEmailTemplates.subtitle")}</p>

      {loading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : (
        <div className={styles.cardGrid}>
          {templates.map((tpl) => (
            <button
              key={tpl.template_key}
              type="button"
              className={styles.card}
              onClick={() => openTemplate(tpl.template_key)}
            >
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>{t(KEY_LABEL_KEY[tpl.template_key])}</span>
              </div>
              <div className={styles.cardMeta}>{tpl.subject_el}</div>
              {tpl.updated_by_name && (
                <div className={styles.cardMeta}>{t("adminEmailTemplates.updatedBy", { name: tpl.updated_by_name })}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className={styles.editor}>
          <div className={styles.editorHeader}>
            <h2>{t(KEY_LABEL_KEY[selected.template_key])}</h2>
            <button type="button" className="btn btn-secondary" onClick={close}>
              {t("common.close")}
            </button>
          </div>

          <div className={styles.variableList}>
            <strong>{t("adminEmailTemplates.availableVariables")}:</strong>
            {selected.available_variables.map((v) => (
              <code key={v} className={styles.variableChip}>{`{{${v}}}`}</code>
            ))}
          </div>

          <label className={styles.label}>{t("adminEmailTemplates.subjectElLabel")}</label>
          <input className="input" value={subjectEl} onChange={(e) => setSubjectEl(e.target.value)} />

          <label className={styles.label}>{t("adminEmailTemplates.subjectEnLabel")}</label>
          <input className="input" value={subjectEn} onChange={(e) => setSubjectEn(e.target.value)} />

          <label className={styles.label}>{t("adminEmailTemplates.bodyElLabel")}</label>
          <textarea
            className={`input ${styles.contentArea}`}
            value={bodyEl}
            onChange={(e) => setBodyEl(e.target.value)}
            rows={12}
          />

          <label className={styles.label}>{t("adminEmailTemplates.bodyEnLabel")}</label>
          <textarea
            className={`input ${styles.contentArea}`}
            value={bodyEn}
            onChange={(e) => setBodyEn(e.target.value)}
            rows={8}
          />

          {error && <div className={styles.blockError}>{error}</div>}
          {savedMessage && <div className={styles.savedMessage}>{savedMessage}</div>}

          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
              {t("adminEmailTemplates.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

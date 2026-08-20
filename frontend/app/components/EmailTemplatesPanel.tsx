"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type {
  EmailSettingsEntry,
  EmailTemplateDetail,
  EmailTemplateKey,
  EmailTemplateSummary,
  EmailTestSendResponse,
} from "../lib/types";
import styles from "./EmailTemplatesPanel.module.css";

const KEY_LABEL_KEY: Record<EmailTemplateKey, TranslationKey> = {
  invite: "adminEmailTemplates.keyInvite",
  welcome: "adminEmailTemplates.keyWelcome",
  password_reset: "adminEmailTemplates.keyPasswordReset",
  email_verification: "adminEmailTemplates.keyEmailVerification",
  invite_no_company: "adminEmailTemplates.keyInviteNoCompany",
  beta_approved: "adminEmailTemplates.keyBetaApproved",
};

const TEST_SEND_MESSAGE_KEY: Record<NonNullable<EmailTestSendResponse["reason"]> | "success", TranslationKey> = {
  success: "adminEmailTemplates.testSendSuccess",
  disabled: "adminEmailTemplates.testSendDisabled",
  send_failed: "adminEmailTemplates.testSendFailed",
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

  const [testAddress, setTestAddress] = useState("");
  const [testAddressBusy, setTestAddressBusy] = useState(false);
  const [testAddressSaved, setTestAddressSaved] = useState(false);
  const [testSendBusy, setTestSendBusy] = useState(false);
  const [testSendMessage, setTestSendMessage] = useState<string | null>(null);

  async function refreshList() {
    if (!token) return;
    setLoading(true);
    try {
      const [tpls, emailSettings] = await Promise.all([
        api.get<EmailTemplateSummary[]>("/admin/email-templates", token),
        api.get<EmailSettingsEntry>("/admin/email-settings", token),
      ]);
      setTemplates(tpls);
      setTestAddress(emailSettings.test_email_address);
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
    setTestSendMessage(null);
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
    setTestSendMessage(null);
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

  async function saveTestAddress() {
    if (!token) return;
    setTestAddressBusy(true);
    setTestAddressSaved(false);
    try {
      const data = await api.patch<EmailSettingsEntry>("/admin/email-settings", { test_email_address: testAddress }, token);
      setTestAddress(data.test_email_address);
      setTestAddressSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTestAddressBusy(false);
    }
  }

  async function sendTest() {
    if (!token || !selected) return;
    setTestSendBusy(true);
    setTestSendMessage(null);
    try {
      // Sends whatever's currently in the editor, including unsaved edits -
      // a preview, not a save.
      const result = await api.post<EmailTestSendResponse>(
        `/admin/email-templates/${selected.template_key}/test-send`,
        { subject_el: subjectEl, subject_en: subjectEn, body_el: bodyEl, body_en: bodyEn },
        token
      );
      setTestSendMessage(t(TEST_SEND_MESSAGE_KEY[result.sent ? "success" : result.reason ?? "send_failed"]));
    } catch (err) {
      setTestSendMessage(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTestSendBusy(false);
    }
  }

  return (
    <div>
      <h1>{t("adminEmailTemplates.title")}</h1>
      <p className="text-muted">{t("adminEmailTemplates.subtitle")}</p>

      <div className={styles.settingsRow}>
        <label className={styles.label}>{t("adminEmailTemplates.testEmailAddressLabel")}</label>
        <div className={styles.settingsInputRow}>
          <input
            className="input"
            type="email"
            value={testAddress}
            onChange={(e) => {
              setTestAddress(e.target.value);
              setTestAddressSaved(false);
            }}
          />
          <button type="button" className="btn btn-secondary" disabled={testAddressBusy} onClick={saveTestAddress}>
            {t("adminEmailTemplates.testEmailAddressSave")}
          </button>
          {testAddressSaved && <span className={styles.savedMessage}>{t("adminEmailTemplates.testEmailAddressSaved")}</span>}
        </div>
      </div>

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
        <div className={styles.modalScrim} onClick={close}>
          <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{t(KEY_LABEL_KEY[selected.template_key])}</h2>
              <button type="button" className="btn btn-secondary" onClick={close}>
                {t("common.close")}
              </button>
            </div>

            <div className={styles.modalBody}>
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
              {testSendMessage && <div className={styles.savedMessage}>{testSendMessage}</div>}
            </div>

            <div className={styles.modalActions}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {t("adminEmailTemplates.save")}
              </button>
              <button type="button" className="btn btn-secondary" disabled={testSendBusy} onClick={sendTest}>
                {t("adminEmailTemplates.testSend")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

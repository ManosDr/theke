"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import type { AdminResetPasswordResponse } from "../lib/types";
import styles from "./CompaniesPanel.module.css";

interface ResetPasswordTarget {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

// Shared by the super-admin Companies/Users screens (POST
// /admin/users/{id}/reset-password) and the company-admin Users/Χρήστες tab
// (POST /companies/me/users/{id}/reset-password) - same UI, different
// endpoint, passed in by the caller rather than duplicated per screen.
export default function ResetPasswordModal({
  user,
  token,
  emailEnabled,
  endpoint,
  onClose,
}: {
  user: ResetPasswordTarget;
  token: string | null;
  emailEnabled: boolean;
  endpoint: string;
  onClose: () => void;
}) {
  const { t, tUpper } = useLocale();
  const [stage, setStage] = useState<"confirm" | "generated" | "linkSent">("confirm");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  async function generatePassword() {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<AdminResetPasswordResponse>(endpoint, undefined, token);
      setNewPassword(result.new_password);
      setStage("generated");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendLink() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email: user.email });
      setStage("linkSent");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPassword() {
    await navigator.clipboard.writeText(newPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (stage === "generated") {
    return (
      <div className={styles.modalScrim}>
        <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reset-password-done-title">
          <div className={styles.modalHeader}>
            <h2 id="reset-password-done-title" style={{ margin: 0 }}>
              {t("companies.resetPassword.doneTitle")}
            </h2>
          </div>

          <div className={styles.modalSection}>
            <div className={styles.listRow}>
              <span>{t("companies.resetPassword.userLabel")}</span>
              <strong>
                {user.first_name || user.last_name
                  ? `${`${user.first_name ?? ""} ${user.last_name ?? ""}`.trim()} (${user.email})`
                  : user.email}
              </strong>
            </div>
          </div>

          <div className={styles.modalSection}>
            <h4>{tUpper("companies.created.password")}</h4>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: "1.1rem",
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--admin-chip-bg)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                {newPassword}
              </code>
              <button type="button" className="btn btn-secondary" onClick={copyPassword}>
                {copied ? t("companies.created.copied") : t("companies.created.copy")}
              </button>
            </div>
            <p className={styles.reassignWarning} style={{ marginTop: "var(--space-3)" }}>
              {t("companies.resetPassword.warning")}
            </p>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t("companies.resetPassword.close")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "linkSent") {
    return (
      <div className={styles.modalScrim}>
        <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reset-link-sent-title">
          <div className={styles.modalHeader}>
            <h2 id="reset-link-sent-title" style={{ margin: 0 }}>
              {t("companies.resetPassword.linkSentTitle")}
            </h2>
          </div>
          <div className={styles.modalSection}>
            <p>{t("companies.resetPassword.linkSentBody", { email: user.email })}</p>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t("companies.resetPassword.close")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-password-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="reset-password-confirm-title" style={{ margin: 0 }}>
            {t("companies.resetPassword.confirmTitle")}
          </h2>
        </div>

        {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

        <div className={styles.modalSection}>
          <div className={styles.listRow}>
            <span>{t("companies.resetPassword.userLabel")}</span>
            <strong>
              {user.first_name || user.last_name
                ? `${`${user.first_name ?? ""} ${user.last_name ?? ""}`.trim()} (${user.email})`
                : user.email}
            </strong>
          </div>
          <p className="text-muted" style={{ marginTop: "var(--space-2)" }}>
            {t("companies.resetPassword.confirmBody")}
          </p>
        </div>

        <div className={styles.modalFooter} style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--space-3)" }}>
          <button type="button" className="btn btn-primary" disabled={submitting} onClick={generatePassword}>
            {t("companies.resetPassword.generateButton")}
          </button>
          {emailEnabled && (
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={sendLink}>
              {t("companies.resetPassword.orSendLink", { email: user.email })}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            {t("companies.resetPassword.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

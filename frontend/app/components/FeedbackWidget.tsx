"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { ChatIcon } from "./NavIcons";
import { BookIcon, BugIcon, LightbulbIcon } from "./UiIcons";
import styles from "./FeedbackWidget.module.css";

type Category = "bug" | "suggestion" | "content_gap";

const MESSAGE_MAX_LENGTH = 500;

const CATEGORIES: { value: Category; Icon: typeof BugIcon; labelKey: "feedbackWidget.categoryBug" | "feedbackWidget.categorySuggestion" | "feedbackWidget.categoryContentGap" }[] = [
  { value: "bug", Icon: BugIcon, labelKey: "feedbackWidget.categoryBug" },
  { value: "suggestion", Icon: LightbulbIcon, labelKey: "feedbackWidget.categorySuggestion" },
  { value: "content_gap", Icon: BookIcon, labelKey: "feedbackWidget.categoryContentGap" },
];

// Floating, not nav-embedded, so it never shifts page layout - present on
// every authenticated page via AppShell, per the beta soft-launch spec.
export function FeedbackWidget() {
  const { user } = useAuth();
  const { t } = useLocale();
  const pathname = usePathname();
  const token = user?.token ?? null;

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close();
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    setCategory("bug");
    setMessage("");
    setSubmitted(false);
  }

  async function submit() {
    if (!token) return;
    setSubmitting(true);
    try {
      await api.post(
        "/user-feedback",
        { category, message: message.trim() || null, page_url: pathname },
        token
      );
      setSubmitted(true);
      setTimeout(close, 1500);
    } catch {
      // Best-effort - if it fails, the user can just try again; not worth
      // a dedicated error UI for a lightweight feedback form.
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      {open && (
        <div className={styles.panel} role="dialog" aria-label={t("feedbackWidget.title")}>
          {submitted ? (
            <p className={styles.thanks}>{t("feedbackWidget.thanks")}</p>
          ) : (
            <>
              <h3 className={styles.panelTitle}>{t("feedbackWidget.title")}</h3>
              <div className={styles.categoryRow}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={category === c.value ? styles.categoryButtonActive : styles.categoryButton}
                    onClick={() => setCategory(c.value)}
                  >
                    <c.Icon size={16} />
                    {t(c.labelKey)}
                  </button>
                ))}
              </div>
              <textarea
                className={`input ${styles.textarea}`}
                rows={3}
                maxLength={MESSAGE_MAX_LENGTH}
                placeholder={t("feedbackWidget.messagePlaceholder")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className={styles.charCount}>{message.length}/{MESSAGE_MAX_LENGTH}</div>
              <div className={styles.actions}>
                <button type="button" className="btn btn-secondary" onClick={close}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                  {submitting ? t("common.loading") : t("feedbackWidget.submit")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("feedbackWidget.title")}
      >
        <ChatIcon size={22} />
      </button>
    </div>
  );
}

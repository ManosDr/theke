"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { useVertical } from "../lib/vertical";
import type { VerticalSummary } from "../lib/types";
import styles from "./VerticalEditorPanel.module.css";

const ACCENT_CLASS: Record<string, string> = {
  construction: styles.accentConstruction,
  tax_accounting: styles.accentTax,
};

export function VerticalEditorPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;
  const { selectedVertical } = useVertical();

  const [verticals, setVerticals] = useState<VerticalSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api
      .get<VerticalSummary[]>("/admin/verticals", token)
      .then(setVerticals)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  const visible = selectedVertical === "all" ? verticals : verticals.filter((v) => v.slug === selectedVertical);

  return (
    <div>
      <h1>{t("verticalEditor.title")}</h1>
      <div className={styles.grid} style={{ marginTop: "var(--space-4)" }}>
        {visible.map((v) => (
          <VerticalCard key={v.id} vertical={v} token={token} />
        ))}
      </div>
    </div>
  );
}

function VerticalCard({ vertical, token }: { vertical: VerticalSummary; token: string | null }) {
  const { t } = useLocale();
  const accent = ACCENT_CLASS[vertical.slug] ?? "";

  const [tagline, setTagline] = useState(vertical.tagline ?? "");
  const [welcomeMessage, setWelcomeMessage] = useState(vertical.welcome_message ?? "");
  const [disclaimerText, setDisclaimerText] = useState(vertical.disclaimer_text ?? "");
  const [offTopicHint, setOffTopicHint] = useState(vertical.off_topic_hint ?? "");
  const [systemPromptOverride, setSystemPromptOverride] = useState(vertical.system_prompt_override ?? "");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      await api.patch(
        `/admin/verticals/${vertical.id}`,
        {
          tagline,
          welcome_message: welcomeMessage,
          disclaimer_text: disclaimerText,
          off_topic_hint: offTopicHint,
          system_prompt_override: systemPromptOverride || null,
        },
        token
      );
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  const disclaimerLen = disclaimerText.length;

  return (
    <div className={`card ${styles.card} ${accent}`}>
      <h2 style={{ marginTop: 0 }}>{vertical.display_name}</h2>

      <div className={styles.field}>
        <label>{t("verticalEditor.tagline")}</label>
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} />
      </div>

      <div className={styles.field}>
        <label>{t("verticalEditor.welcomeMessage")}</label>
        <textarea rows={2} value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} />
      </div>

      <div className={styles.field}>
        <label>{t("verticalEditor.disclaimerText")}</label>
        <textarea rows={3} value={disclaimerText} onChange={(e) => setDisclaimerText(e.target.value.slice(0, 150))} />
        <span className={`${styles.charCount} ${disclaimerLen > 140 ? styles.charCountWarn : ""}`}>
          {t("verticalEditor.disclaimerCharCount", { count: disclaimerLen })}
        </span>
        <div className={styles.disclaimerPreview}>{disclaimerText}</div>
      </div>

      <div className={styles.field}>
        <label>{t("verticalEditor.offTopicHint")}</label>
        <textarea rows={2} value={offTopicHint} onChange={(e) => setOffTopicHint(e.target.value)} />
      </div>

      <div className={styles.field}>
        <button type="button" className={styles.systemPromptToggle} onClick={() => setShowSystemPrompt((v) => !v)}>
          {showSystemPrompt ? "▾" : "▸"} {t("verticalEditor.systemPromptToggle")}
        </button>
        {showSystemPrompt && (
          <>
            <div className={styles.systemPromptWarning}>{t("verticalEditor.systemPromptWarning")}</div>
            <textarea
              rows={6}
              className={styles.systemPromptTextarea}
              value={systemPromptOverride}
              onChange={(e) => setSystemPromptOverride(e.target.value)}
            />
            <button type="button" className={styles.resetLink} onClick={() => setSystemPromptOverride("")}>
              {t("verticalEditor.resetToDefault")}
            </button>
          </>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.regionalBadge}>
          {t("verticalEditor.regionalScoping")}:{" "}
          {vertical.uses_regional_scoping ? t("verticalEditor.yes") : t("verticalEditor.no")}
        </span>
      </div>

      <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
        {t("verticalEditor.save")}
      </button>

      <div className={styles.footer}>
        <span>{t("verticalEditor.effectImmediately")}</span>
        {savedAt && <span>{t("verticalEditor.saved", { when: savedAt.toLocaleTimeString() })}</span>}
      </div>
    </div>
  );
}

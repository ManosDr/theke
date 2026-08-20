"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import dashStyles from "../dashboard/dashboard.module.css";

interface PlatformSettingsEntry {
  beta_ended: boolean;
  updated_at: string;
}

export function SystemSettingsPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [settings, setSettings] = useState<PlatformSettingsEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .get<PlatformSettingsEntry>("/admin/platform-settings", token)
      .then(setSettings)
      .finally(() => setLoading(false));
  }, [token]);

  async function setBetaEnded(betaEnded: boolean) {
    if (!token) return;
    setSaving(true);
    try {
      const updated = await api.patch<PlatformSettingsEntry>("/admin/platform-settings", { beta_ended: betaEnded }, token);
      setSettings(updated);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <h1>{t("systemSettings.title")}</h1>

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={dashStyles.sectionHeader}>
          <h2>{t("systemSettings.betaHeading")}</h2>
        </div>
        <p className="text-muted" style={{ fontSize: "0.9rem" }}>
          {settings?.beta_ended ? t("systemSettings.betaEndedHint") : t("systemSettings.betaActiveHint")}
        </p>

        {settings?.beta_ended ? (
          <p style={{ fontWeight: 600, color: "var(--admin-success)" }}>{t("systemSettings.betaEndedStatus")}</p>
        ) : confirming ? (
          <div className="card" style={{ padding: "var(--space-4)", background: "var(--admin-warning-bg)", border: "1px solid var(--admin-warning-border)" }}>
            <p style={{ margin: 0 }}>{t("systemSettings.confirmEndBeta")}</p>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setBetaEnded(true)} disabled={saving}>
                {t("systemSettings.confirmEndBetaButton")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={saving}>
            {t("systemSettings.endBetaButton")}
          </button>
        )}
      </section>
    </div>
  );
}

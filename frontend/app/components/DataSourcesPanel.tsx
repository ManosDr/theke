"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { useVertical } from "../lib/vertical";
import type { DataSourceSummary, DataSourcesByVertical } from "../lib/types";
import styles from "./DataSourcesPanel.module.css";
import dashStyles from "../dashboard/dashboard.module.css";

const ACCENT_CLASS: Record<string, string> = {
  construction: styles.accentConstruction,
  tax_accounting: styles.accentTax,
};

type Health = "healthy" | "overdue" | "failed" | "syncing" | "inactive" | "never_synced";

function healthOf(source: DataSourceSummary, syncing: boolean): Health {
  if (syncing) return "syncing";
  if (!source.is_active) return "inactive";
  if (!source.last_crawled_at) return "never_synced";
  if (source.last_crawl_status && /fail|error/i.test(source.last_crawl_status)) return "failed";
  if (source.next_crawl_at && new Date(source.next_crawl_at) < new Date()) return "overdue";
  return "healthy";
}

const HEALTH_ICON: Record<Health, string> = {
  healthy: "✓",
  overdue: "⚠",
  failed: "✗",
  syncing: "↻",
  inactive: "●",
  never_synced: "●",
};

const FREQUENCIES: DataSourceSummary["crawl_frequency_type"][] = ["daily", "weekly", "monthly", "custom"];

export function DataSourcesPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;
  const { selectedVertical } = useVertical();

  const [groups, setGroups] = useState<DataSourcesByVertical[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.get<DataSourcesByVertical[]>("/admin/data-sources", token);
      setGroups(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const visibleGroups = useMemo(
    () => (selectedVertical === "all" ? groups : groups.filter((g) => g.vertical_slug === selectedVertical)),
    [groups, selectedVertical]
  );

  async function syncNow(id: number) {
    if (!token) return;
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await api.post(`/admin/data-sources/${id}/sync`, undefined, token);
      await refresh();
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <h1>{t("adminSources.title")}</h1>

      {visibleGroups.map((group) => (
        <div key={group.vertical_slug} className={styles.categoryGroup}>
          {selectedVertical === "all" && (
            <button
              type="button"
              className={styles.categoryHeader}
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.vertical_slug]: !prev[group.vertical_slug] }))}
            >
              {collapsed[group.vertical_slug] ? "▸" : "▾"} {group.vertical_display_name}
              <span className={styles.categoryCount}>{group.sources.length}</span>
            </button>
          )}

          {!collapsed[group.vertical_slug] &&
            (group.sources.length === 0 ? (
              <p className={dashStyles.emptyState}>{t("adminSources.empty")}</p>
            ) : (
              group.sources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  verticalSlug={group.vertical_slug}
                  syncing={syncingIds.has(source.id)}
                  editing={editingId === source.id}
                  onToggleEdit={() => setEditingId(editingId === source.id ? null : source.id)}
                  onSync={() => syncNow(source.id)}
                  onSaved={refresh}
                  token={token}
                />
              ))
            ))}
        </div>
      ))}
    </div>
  );
}

function SourceCard({
  source,
  verticalSlug,
  syncing,
  editing,
  onToggleEdit,
  onSync,
  onSaved,
  token,
}: {
  source: DataSourceSummary;
  verticalSlug: string;
  syncing: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  onSync: () => void;
  onSaved: () => void;
  token: string | null;
}) {
  const { t } = useLocale();
  const health = healthOf(source, syncing);
  const accent = ACCENT_CLASS[verticalSlug] ?? "";

  const [freqType, setFreqType] = useState(source.crawl_frequency_type);
  const [freqDays, setFreqDays] = useState(source.crawl_frequency_days);
  const [isActive, setIsActive] = useState(source.is_active);
  const [notes, setNotes] = useState(source.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      await api.patch(
        `/admin/data-sources/${source.id}`,
        { crawl_frequency_type: freqType, crawl_frequency_days: freqDays, is_active: isActive, notes },
        token
      );
      onSaved();
      onToggleEdit();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`card ${styles.sourceCard} ${styles[health]}`}>
      <div>
        <h3 className={styles.sourceName}>{source.name}</h3>
        <span className={styles.sourceUrl}>🔗 {source.base_url}</span>
        <div className={styles.pillRow}>
          <span className={`${styles.pill} ${accent}`}>{t(`vertical.${verticalSlug}` as TranslationKey)}</span>
        </div>
      </div>

      <div>
        {health !== "never_synced" && source.last_crawled_at && (
          <div className="text-muted" style={{ fontSize: "0.8rem" }} title={new Date(source.last_crawled_at).toString()}>
            {t("adminSources.lastSync", { when: new Date(source.last_crawled_at).toLocaleDateString() })}
          </div>
        )}
        <div className={`${styles.statusLine} ${styles[health]}`}>
          {HEALTH_ICON[health]}{" "}
          {health === "never_synced"
            ? t("adminSources.health.never_synced")
            : health === "failed" && source.last_crawl_error
              ? `${t("adminSources.health.failed")} — ${source.last_crawl_error}`
              : health === "healthy" && source.last_crawl_document_count != null
                ? t("adminSources.documentCount", { count: source.last_crawl_document_count })
                : t(`adminSources.health.${health}` as TranslationKey)}
        </div>
        {source.next_crawl_at && (
          <div className="text-muted" style={{ fontSize: "0.8rem" }}>
            {health === "overdue"
              ? t("adminSources.overdueSince", { when: new Date(source.next_crawl_at).toLocaleDateString() })
              : t("adminSources.nextSync", { when: new Date(source.next_crawl_at).toLocaleDateString() })}
          </div>
        )}
        <span className={styles.freqPill}>{t(`adminSources.frequency.${source.crawl_frequency_type}` as TranslationKey)}</span>
      </div>

      <div className={styles.actionsCol}>
        <button type="button" className="btn btn-primary" disabled={syncing} onClick={onSync}>
          {syncing ? `↻ ${t("adminSources.syncing")}` : t("adminSources.syncNow")}
        </button>
        <button type="button" className={styles.settingsLink} onClick={onToggleEdit}>
          {t("adminSources.settings")}
        </button>
      </div>

      {editing && (
        <div className={styles.cadenceEditor}>
          <div className={styles.freqButtonGroup}>
            {FREQUENCIES.map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.freqButton} ${freqType === f ? styles.freqButtonActive : ""}`}
                onClick={() => setFreqType(f)}
              >
                {t(`adminSources.frequency.${f}` as TranslationKey)}
              </button>
            ))}
          </div>

          {freqType === "custom" && (
            <div className={styles.editorRow}>
              <label>{t("adminSources.everyLabel")}</label>
              <input
                type="number"
                className="input"
                style={{ width: 100 }}
                value={freqDays}
                min={1}
                onChange={(e) => setFreqDays(Number(e.target.value))}
              />
              <span>{t("adminSources.daysLabel")}</span>
            </div>
          )}

          <div className={styles.editorRow}>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              {t("adminSources.active")}
            </label>
          </div>

          <div className={styles.editorRow}>
            <textarea
              className="input"
              style={{ width: "100%", minHeight: 60 }}
              placeholder={t("adminSources.notes")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className={styles.editorActions}>
            <button type="button" className="btn btn-secondary" onClick={onToggleEdit}>
              {t("adminSources.cancel")}
            </button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
              {t("adminSources.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

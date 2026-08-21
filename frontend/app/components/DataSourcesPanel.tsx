"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { sortItems, useSortState } from "../lib/useSortableData";
import { useVertical } from "../lib/vertical";
import type { DataSourceSummary, DataSourcesByVertical, SyncAllResponse, SyncAllStatusResponse } from "../lib/types";
import { ShieldIcon } from "./NavIcons";
import { SortToggleButton } from "./SortableTh";
import { InfoIcon } from "./StatIcons";
import { CheckIcon, CloseIcon, DotIcon, LinkIcon, RefreshIcon, WarningIcon } from "./UiIcons";
import Tooltip from "./Tooltip";
import styles from "./DataSourcesPanel.module.css";
import dashStyles from "../dashboard/dashboard.module.css";

const ACCENT_CLASS: Record<string, string> = {
  construction: styles.accentConstruction,
  tax_accounting: styles.accentTax,
};

// Mirrors FAILURE_THRESHOLD in crawler/crawler/data_source_health_check.py -
// kept as a literal here (not fetched from the backend) since it's a small,
// rarely-changed constant and the two are in different deployable services;
// if it ever changes, update both.
const FAILURE_BANNER_THRESHOLD = 3;

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - parseApiDate(iso).getTime()) / 86_400_000));
}

type Health = "healthy" | "overdue" | "failed" | "blocked" | "syncing" | "inactive" | "never_synced";

function healthOf(source: DataSourceSummary, syncing: boolean): Health {
  if (syncing) return "syncing";
  if (!source.is_active) return "inactive";
  if (!source.last_crawled_at) return "never_synced";
  // Checked before the generic /fail|error/i match below - a ban/403 is
  // reported as its own last_crawl_status ("blocked") specifically so it
  // doesn't fold into the ordinary "failed" bucket (see KNOWN_DECISIONS.md).
  if (source.last_crawl_status === "blocked") return "blocked";
  if (source.last_crawl_status && /fail|error/i.test(source.last_crawl_status)) return "failed";
  if (source.next_crawl_at && parseApiDate(source.next_crawl_at) < new Date()) return "overdue";
  return "healthy";
}

const HEALTH_ICON: Record<Health, typeof CheckIcon> = {
  healthy: CheckIcon,
  overdue: WarningIcon,
  failed: CloseIcon,
  blocked: ShieldIcon,
  syncing: RefreshIcon,
  inactive: DotIcon,
  never_synced: DotIcon,
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
  const [showOnlyFailing, setShowOnlyFailing] = useState(false);
  const [search, setSearch] = useState("");
  const [filterHealth, setFilterHealth] = useState<"" | Health>("");
  const { sortColumn, sortDirection, toggleSort } = useSortState();

  // Sync All - same live-progress bulk-run pattern as DocumentsPanel's
  // "Επικύρωση όλων με AI" (see that component's bulkRunning/bulkStatus
  // state and its own comment on the shared backend tracker).
  const [syncAllRunning, setSyncAllRunning] = useState(false);
  const [syncAllTotal, setSyncAllTotal] = useState(0);
  const [syncAllStatus, setSyncAllStatus] = useState<SyncAllStatusResponse | null>(null);
  const [syncAllComplete, setSyncAllComplete] = useState<{ healthy: number; failed: number; blocked: number } | null>(null);

  async function runSyncAll() {
    if (!token) return;
    const data = await api.post<SyncAllResponse>("/admin/data-sources/sync-all", undefined, token);
    setSyncAllTotal(data.queued);
    setSyncAllComplete(null);
    if (data.queued > 0) setSyncAllRunning(true);
  }

  useEffect(() => {
    if (!syncAllRunning || !token) return;
    const interval = setInterval(async () => {
      const data = await api.get<SyncAllStatusResponse>("/admin/data-sources/sync-all/status", token);
      setSyncAllStatus(data);
      if (data.pending === 0) {
        setSyncAllRunning(false);
        setSyncAllComplete({ healthy: data.healthy, failed: data.failed, blocked: data.blocked });
        refresh();
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncAllRunning, token]);

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

  const failingSources = useMemo(
    () =>
      visibleGroups.flatMap((g) => g.sources.filter((s) => s.consecutive_failures >= FAILURE_BANNER_THRESHOLD)),
    [visibleGroups]
  );

  const hasFilters = Boolean(search || filterHealth);
  function clearFilters() {
    setSearch("");
    setFilterHealth("");
  }

  function sourceSortValue(source: DataSourceSummary, column: string): string | number | null {
    switch (column) {
      case "name":
        return source.name;
      case "lastSync":
        return source.last_crawled_at ? parseApiDate(source.last_crawled_at).getTime() : null;
      case "failures":
        return source.consecutive_failures;
      default:
        return null;
    }
  }

  const displayGroups = useMemo(() => {
    const failingOnly = showOnlyFailing
      ? visibleGroups
          .map((g) => ({ ...g, sources: g.sources.filter((s) => s.consecutive_failures >= FAILURE_BANNER_THRESHOLD) }))
          .filter((g) => g.sources.length > 0)
      : visibleGroups;

    return failingOnly
      .map((g) => ({
        ...g,
        sources: sortItems(
          g.sources.filter((s) => {
            if (search) {
              const q = search.toLowerCase();
              if (!s.name.toLowerCase().includes(q) && !s.base_url.toLowerCase().includes(q)) return false;
            }
            if (filterHealth && healthOf(s, syncingIds.has(s.id)) !== filterHealth) return false;
            return true;
          }),
          sortColumn,
          sortDirection,
          sourceSortValue
        ),
      }))
      .filter((g) => g.sources.length > 0 || (!search && !filterHealth && !showOnlyFailing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleGroups, showOnlyFailing, search, filterHealth, sortColumn, sortDirection, syncingIds]);

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
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-3)" }}>
        <h1 style={{ marginBottom: 0 }}>
          {t("adminSources.title")}
          <Tooltip text={t("adminSources.healthLegendTooltip")}>
            <InfoIcon size={13} />
          </Tooltip>
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginLeft: "auto" }}>
          {syncAllRunning && syncAllStatus ? (
            <span className="text-muted">
              {t("adminSources.syncAll.progress", {
                total: syncAllTotal,
                done: Math.max(0, syncAllTotal - syncAllStatus.pending),
              })}
              {syncAllStatus.current_source_name ? ` — ${syncAllStatus.current_source_name}` : ""}
            </span>
          ) : syncAllComplete ? (
            <span className="text-muted">
              {t("adminSources.syncAll.complete", { healthy: syncAllComplete.healthy })}
              {syncAllComplete.failed + syncAllComplete.blocked > 0 &&
                " " + t("adminSources.syncAll.stillFailing", { count: syncAllComplete.failed + syncAllComplete.blocked })}
            </span>
          ) : null}
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <button type="button" className="btn btn-secondary" disabled={syncAllRunning} onClick={runSyncAll}>
              {syncAllRunning ? t("adminSources.syncAll.running") : t("adminSources.syncAll.button")}
            </button>
            <Tooltip text={t("adminSources.syncAll.tooltip")}>
              <InfoIcon size={13} />
            </Tooltip>
          </span>
        </div>
      </div>

      {failingSources.length > 0 && (
        <div className={styles.failureBanner}>
          <div className={styles.failureBannerHeader}>
            <span className={styles.failureBannerTitle}>
              <WarningIcon size={16} />
              {t("adminSources.failingBanner.heading", { count: failingSources.length })}
            </span>
            <button
              type="button"
              className={styles.failureBannerToggle}
              onClick={() => setShowOnlyFailing((prev) => !prev)}
            >
              {showOnlyFailing ? t("adminSources.failingBanner.showAll") : t("adminSources.failingBanner.filterOnly")}
            </button>
          </div>
          <ul className={styles.failureBannerList}>
            {failingSources.map((source) => {
              const banPattern = source.last_health_check_status === "blocked";
              return (
                <li key={source.id} className={`${styles.failureBannerItem} ${banPattern ? styles.banPattern : ""}`}>
                  {banPattern ? <ShieldIcon size={14} /> : <WarningIcon size={14} />}
                  <span className={styles.failureBannerName}>{source.name}</span>
                  {banPattern && <span className={styles.banPatternTag}>{t("adminSources.failingBanner.banPattern")}</span>}
                  <span className={styles.failureBannerDetail}>
                    {t("adminSources.failingBanner.streak", { count: source.consecutive_failures })}
                    {source.failing_since && ` – ${t("adminSources.failingBanner.days", { count: daysSince(source.failing_since) })}`}
                    {source.last_health_check_error ? ` – ${source.last_health_check_error}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={`card ${styles.filterBar}`}>
        <input
          className={`input ${styles.searchInput}`}
          type="text"
          placeholder={t("adminSources.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select className={`input ${styles.filterSelect}`} value={filterHealth} onChange={(e) => setFilterHealth(e.target.value as "" | Health)}>
          <option value="">{t("docs.filterStatus")}</option>
          {(Object.keys(HEALTH_ICON) as Health[]).map((h) => (
            <option key={h} value={h}>
              {t(`adminSources.health.${h}` as TranslationKey)}
            </option>
          ))}
        </select>

        <div className={styles.sortGroup}>
          <SortToggleButton
            label={t("adminSources.sortName")}
            column="name"
            activeColumn={sortColumn}
            direction={sortDirection}
            onSort={toggleSort}
            className={styles.sortChip}
          />
          <SortToggleButton
            label={t("adminSources.sortLastSync")}
            column="lastSync"
            activeColumn={sortColumn}
            direction={sortDirection}
            onSort={toggleSort}
            className={styles.sortChip}
          />
          <SortToggleButton
            label={t("adminSources.sortFailures")}
            column="failures"
            activeColumn={sortColumn}
            direction={sortDirection}
            onSort={toggleSort}
            className={styles.sortChip}
          />
        </div>

        {hasFilters && (
          <button type="button" className={styles.clearFilters} onClick={clearFilters}>
            {t("docs.clearFilters")}
          </button>
        )}
      </div>

      {displayGroups.length === 0 && (hasFilters || showOnlyFailing) && (
        <p className={dashStyles.emptyState}>{t("chat.context.noResults")}</p>
      )}

      {displayGroups.map((group) => (
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
        {
          crawl_frequency_type: freqType,
          // Only a genuinely custom cadence carries an explicit day count -
          // for daily/weekly/monthly, omit it so the backend's own
          // type->days mapping (admin.py's _FREQUENCY_DAYS) applies instead
          // of resubmitting whatever stale value was last set under a
          // different frequency type.
          crawl_frequency_days: freqType === "custom" ? freqDays : undefined,
          is_active: isActive,
          notes,
        },
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
        <span className={styles.sourceUrl}>
          <LinkIcon size={13} />
          {source.base_url}
        </span>
        <div className={styles.pillRow}>
          <span className={`${styles.pill} ${accent}`}>{t(`vertical.${verticalSlug}` as TranslationKey)}</span>
        </div>
      </div>

      <div>
        {health !== "never_synced" && source.last_crawled_at && (
          <div className="text-muted" style={{ fontSize: "0.8rem" }} title={parseApiDate(source.last_crawled_at).toString()}>
            {t("adminSources.lastSync", { when: parseApiDate(source.last_crawled_at).toLocaleDateString() })}
          </div>
        )}
        <div className={`${styles.statusLine} ${styles[health]}`}>
          {(() => {
            const HealthIcon = HEALTH_ICON[health];
            return <HealthIcon size={14} />;
          })()}{" "}
          {health === "never_synced"
            ? t("adminSources.health.never_synced")
            : (health === "failed" || health === "blocked") && source.last_crawl_error
              ? `${t(`adminSources.health.${health}` as TranslationKey)}: ${source.last_crawl_error}`
              : health === "healthy" && source.last_crawl_document_count != null
                ? t("adminSources.documentCount", { count: source.last_crawl_document_count })
                : t(`adminSources.health.${health}` as TranslationKey)}
        </div>
        {source.next_crawl_at && (
          <div className="text-muted" style={{ fontSize: "0.8rem" }}>
            {health === "overdue"
              ? t("adminSources.overdueSince", { when: parseApiDate(source.next_crawl_at).toLocaleDateString() })
              : t("adminSources.nextSync", { when: parseApiDate(source.next_crawl_at).toLocaleDateString() })}
          </div>
        )}
        <span className={styles.freqPill}>{t(`adminSources.frequency.${source.crawl_frequency_type}` as TranslationKey)}</span>
      </div>

      <div className={styles.actionsCol}>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
            disabled={syncing}
            onClick={onSync}
          >
            {syncing && <RefreshIcon size={14} />}
            {syncing ? t("adminSources.syncing") : t("adminSources.syncNow")}
          </button>
          <Tooltip text={t("adminSources.syncNowTooltip")}>
            <InfoIcon size={13} />
          </Tooltip>
        </span>
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

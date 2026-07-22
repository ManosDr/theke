"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { useVertical } from "../lib/vertical";
import { AlertIcon, BuildingIcon, ClockIcon, CoinIcon, DatabaseIcon, FlagIcon, InfoIcon } from "../components/StatIcons";
import FieldError from "../components/FieldError";
import Tooltip from "../components/Tooltip";
import { TRANSLATION_KEYS, translations, type TranslationKey } from "../lib/translations";
import type {
  AdminStatsByVertical,
  AuditLogEntry,
  CompanySummary,
  InfraHealthResponse,
  StaleDocumentSummary,
  VerticalSummary,
} from "../lib/types";
import { ActivityChart } from "./ActivityChart";
import { AttentionCard } from "./AttentionCard";
import { QueriesByVerticalBars } from "./QueriesByVerticalBars";
import { SentimentDonut } from "./SentimentDonut";
import { VerticalStatsCard } from "./VerticalStatsCard";
import styles from "./dashboard.module.css";

const BUILTIN_TRANSLATIONS = translations as Record<string, Partial<Record<TranslationKey, string>>>;

type SecondaryTab = "staleness" | "languages" | "audit";

function groupTranslationKeys(): Record<string, TranslationKey[]> {
  const groups: Record<string, TranslationKey[]> = {};
  for (const key of TRANSLATION_KEYS) {
    const group = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "misc";
    (groups[group] ??= []).push(key);
  }
  return groups;
}

const TRANSLATION_GROUPS = groupTranslationKeys();

function LanguagesPanel() {
  const { user } = useAuth();
  const { t, tUpper, locales, refreshLocales } = useLocale();
  const token = user?.token ?? null;

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addFieldErrors, setAddFieldErrors] = useState<{ code?: string; name?: string }>({});

  const [editLocale, setEditLocale] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loadingOverrides, setLoadingOverrides] = useState(false);

  useEffect(() => {
    if (!editLocale) return;
    setLoadingOverrides(true);
    setSaveMessage(null);
    api
      .get<Record<string, string>>(`/translations/${editLocale}`)
      .then((data) => {
        setOverrides(data);
        setEdits({});
      })
      .finally(() => setLoadingOverrides(false));
  }, [editLocale]);

  function effectiveValue(locale: string, key: TranslationKey): string {
    return overrides[key] ?? BUILTIN_TRANSLATIONS[locale]?.[key] ?? translations.en[key] ?? "";
  }

  async function addLocale(e: React.FormEvent) {
    e.preventDefault();
    const errors: typeof addFieldErrors = {};
    if (!newCode.trim()) errors.code = t("validation.fieldRequired");
    if (!newName.trim()) errors.name = t("validation.fieldRequired");
    setAddFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setAddError(null);
    try {
      await api.post("/admin/locales", { code: newCode.trim(), name: newName.trim() }, token);
      setNewCode("");
      setNewName("");
      refreshLocales();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Failed to add language");
    }
  }

  async function deleteLocale(code: string) {
    await api.del(`/admin/locales/${code}`, token);
    refreshLocales();
    if (editLocale === code) setEditLocale("");
  }

  async function saveTranslations() {
    const changed: Record<string, string> = {};
    for (const [key, value] of Object.entries(edits)) {
      if (value !== effectiveValue(editLocale, key as TranslationKey)) changed[key] = value;
    }
    if (Object.keys(changed).length === 0) return;

    await api.patch(`/admin/translations/${editLocale}`, { values: changed }, token);
    const data = await api.get<Record<string, string>>(`/translations/${editLocale}`);
    setOverrides(data);
    setEdits({});
    setSaveMessage(t("dash.super.textsSaved"));
  }

  return (
    <div>
      <p className="text-muted">{t("dash.super.languagesDescription")}</p>

      <table className={styles.table} style={{ marginTop: "var(--space-4)" }}>
        <thead>
          <tr>
            <th>{tUpper("dash.super.colCode")}</th>
            <th>{tUpper("dash.super.colName")}</th>
            <th>{tUpper("dash.super.colBuiltin")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {locales.map((l) => (
            <tr key={l.code}>
              <td className="text-muted">{l.code}</td>
              <td>{l.name}</td>
              <td className="text-muted">{l.is_builtin ? t("dash.super.typeBuiltin") : t("dash.super.typeCustom")}</td>
              <td className={styles.rowActions}>
                <button className="btn btn-secondary" onClick={() => setEditLocale(l.code)}>
                  {t("dash.super.editTexts")}
                </button>
                {!l.is_builtin && (
                  <button className="btn btn-danger" onClick={() => deleteLocale(l.code)}>
                    {t("dash.super.deleteLanguage")}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className={styles.inlineForm} onSubmit={addLocale} style={{ marginTop: "var(--space-4)" }} noValidate>
        <div>
          <input
            className="input"
            placeholder={t("dash.super.localeCode")}
            value={newCode}
            onChange={(e) => {
              setNewCode(e.target.value);
              if (e.target.value.trim()) setAddFieldErrors((prev) => ({ ...prev, code: undefined }));
            }}
            aria-invalid={!!addFieldErrors.code}
          />
          {addFieldErrors.code && <FieldError message={addFieldErrors.code} />}
        </div>
        <div>
          <input
            className="input"
            placeholder={t("dash.super.localeName")}
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (e.target.value.trim()) setAddFieldErrors((prev) => ({ ...prev, name: undefined }));
            }}
            aria-invalid={!!addFieldErrors.name}
          />
          {addFieldErrors.name && <FieldError message={addFieldErrors.name} />}
        </div>
        <button type="submit" className="btn btn-primary">
          {t("dash.super.add")}
        </button>
      </form>
      {addError && <p style={{ color: "var(--color-danger)" }}>{addError}</p>}

      {editLocale && (
        <div className={styles.translationScroll}>
          {loadingOverrides ? (
            <p className="text-muted">{t("common.loading")}</p>
          ) : (
            Object.entries(TRANSLATION_GROUPS).map(([group, keys]) => (
              <div key={group} className={styles.translationGroup}>
                <h4>{group}</h4>
                {keys.map((key) => (
                  <div key={key} className={styles.translationRow}>
                    <label htmlFor={`tr-${key}`}>{key.split(".").pop()}</label>
                    <input
                      id={`tr-${key}`}
                      className="input"
                      value={edits[key] ?? effectiveValue(editLocale, key)}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {editLocale && !loadingOverrides && (
        <div style={{ marginTop: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <button className="btn btn-primary" onClick={saveTranslations}>
            {t("dash.super.saveChanges")}
          </button>
          {saveMessage && <span className="text-muted">{saveMessage}</span>}
        </div>
      )}
    </div>
  );
}

export function SuperAdminDashboard() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const router = useRouter();
  const token = user?.token ?? null;
  const { selectedVertical, setSelectedVertical } = useVertical();

  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [verticals, setVerticals] = useState<VerticalSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [staleDocs, setStaleDocs] = useState<StaleDocumentSummary[]>([]);
  const [stats, setStats] = useState<AdminStatsByVertical | null>(null);
  const [infraHealth, setInfraHealth] = useState<InfraHealthResponse | null>(null);

  const [activeTab, setActiveTab] = useState<SecondaryTab>("staleness");

  async function refresh() {
    try {
      const [companiesData, auditData, staleData, statsData, verticalsData, infraHealthData] = await Promise.all([
        api.get<CompanySummary[]>("/admin/companies", token),
        api.get<AuditLogEntry[]>("/admin/audit-log", token),
        api.get<StaleDocumentSummary[]>("/admin/stale-documents", token),
        api.get<AdminStatsByVertical>("/admin/stats", token),
        api.get<VerticalSummary[]>("/admin/verticals", token),
        api.get<InfraHealthResponse>("/admin/infra-health", token),
      ]);
      setCompanies(companiesData);
      setAuditLog(auditData);
      setStaleDocs(staleData);
      setStats(statsData);
      setVerticals(verticalsData);
      setInfraHealth(infraHealthData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load platform data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  if (error) return <p className={styles.emptyState}>{error}</p>;

  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
  const companyVerticalById = new Map(companies.map((c) => [c.id, c.vertical_slug]));
  const statsByVertical = new Map(stats?.by_vertical.map((v) => [v.slug, v]) ?? []);
  const visibleVerticals =
    selectedVertical === "all" ? verticals : verticals.filter((v) => v.slug === selectedVertical);

  // Every section below scopes to this instead of just the top
  // VerticalStatsCard row - selecting a vertical in the sidebar now filters
  // the whole page, not one card.
  const scopedStats = selectedVertical === "all" ? null : statsByVertical.get(selectedVertical);
  const scopedCompanies =
    selectedVertical === "all" ? companies : companies.filter((c) => c.vertical_slug === selectedVertical);
  const scopedStaleDocs =
    selectedVertical === "all" ? staleDocs : staleDocs.filter((d) => d.vertical_slug === selectedVertical);
  // company_id-null entries (platform-level actions with no single owning
  // company, e.g. a locale added) have no vertical of their own - dropped
  // from a vertical-filtered view rather than shown under every vertical.
  const scopedAuditLog =
    selectedVertical === "all"
      ? auditLog
      : auditLog.filter((e) => e.company_id != null && companyVerticalById.get(e.company_id) === selectedVertical);

  const suspendedCount = scopedCompanies.filter((c) => c.is_suspended).length;
  const statsSelectedVertical = verticals.find((v) => v.slug === selectedVertical);

  const gapRate = scopedStats?.gap_rate ?? stats?.total.gap_rate ?? 0;
  const gapTone = gapRate >= 50 ? "danger" : gapRate >= 20 ? "warning" : "success";
  const staleTone = scopedStaleDocs.length > 0 ? "warning" : "success";
  const suspendedTone = suspendedCount > 0 ? "danger" : "success";

  // A single shared vector index/DB has no per-vertical dimension at all -
  // only shown in the unfiltered "all" view rather than fabricating a split
  // that doesn't exist.
  const infraLevel = selectedVertical === "all" ? (infraHealth?.latest?.threshold_level ?? null) : null;
  const infraTone = infraLevel === "critical" ? "danger" : infraLevel === "warning" ? "warning" : "success";
  const infraTrendLabel =
    infraHealth?.trend === "up"
      ? t("dash.super.infraHealthTrendUp")
      : infraHealth?.trend === "down"
        ? t("dash.super.infraHealthTrendDown")
        : infraHealth?.trend === "flat"
          ? t("dash.super.infraHealthTrendFlat")
          : "";

  const totalMessages = scopedStats?.messages ?? stats?.total.total_messages ?? 0;
  const activeDocumentsCount = scopedStats?.active_documents ?? stats?.total.active_documents ?? 0;
  const positiveFeedback = scopedStats?.positive_feedback ?? stats?.total.positive_feedback ?? 0;
  const negativeFeedback = scopedStats?.negative_feedback ?? stats?.total.negative_feedback ?? 0;
  const totalFeedback = positiveFeedback + negativeFeedback;
  const realActiveCompanies = scopedStats?.active_companies ?? stats?.total.real_active_companies ?? 0;

  const platformTokens30d = scopedStats?.platform_tokens_30d ?? stats?.total.platform_tokens_30d ?? 0;
  const platformCost30d = scopedStats?.platform_cost_eur_30d ?? stats?.total.platform_cost_eur_30d ?? 0;
  const platformTokensLabel =
    platformTokens30d >= 1_000_000
      ? t("dash.super.tokensMillions", { count: (platformTokens30d / 1_000_000).toFixed(1) })
      : t("dash.super.tokensCount", { count: platformTokens30d.toLocaleString() });

  return (
    <div>
      <div className={styles.overviewHeader}>
        <h1>{t("dash.super.title")}</h1>
        <p className={styles.overviewSubtitle}>
          {selectedVertical === "all" || !statsSelectedVertical
            ? t("dash.super.subtitle")
            : t("dash.super.subtitleFiltered", { vertical: statsSelectedVertical.display_name })}
        </p>
      </div>

      <div className={styles.verticalCardsRow}>
        {visibleVerticals.map((v) => (
          <VerticalStatsCard
            key={v.id}
            vertical={v}
            stats={statsByVertical.get(v.slug)}
            full={selectedVertical !== "all"}
            onViewDetails={() => setSelectedVertical(v.slug as "construction" | "tax_accounting")}
          />
        ))}
      </div>

      <div className={styles.attentionRow}>
        <AttentionCard
          tone={suspendedTone}
          icon={<FlagIcon size={14} />}
          value={suspendedCount}
          label={tUpper("dash.super.suspended")}
          cta={t("dash.super.manage")}
          onCtaClick={() => router.push("/admin/suspended-tenants")}
        />
        <AttentionCard
          tone={gapTone}
          icon={<AlertIcon size={14} />}
          value={`${gapRate}%`}
          label={
            <>
              {tUpper("dash.super.gapRate")}
              <Tooltip text={t("dash.super.gapRateTooltip")}>
                <InfoIcon size={12} />
              </Tooltip>
            </>
          }
          cta={t("dash.super.reviewGaps")}
          onCtaClick={() => router.push("/admin/chat-gap-rate")}
        />
        <AttentionCard
          tone={staleTone}
          icon={<ClockIcon size={14} />}
          value={scopedStaleDocs.length}
          label={tUpper("dash.super.staleDocs")}
          cta={t("dash.super.reviewQueue")}
          onCtaClick={() => router.push("/admin/stale-documents")}
        />
        <AttentionCard
          tone="warning"
          icon={<CoinIcon size={14} />}
          value={`€${platformCost30d.toFixed(2)}`}
          label={
            <>
              {tUpper("dash.super.platformCost", { tokens: platformTokensLabel })}
              <Tooltip text={t("dash.super.platformCostTooltip")}>
                <InfoIcon size={12} />
              </Tooltip>
            </>
          }
          cta={t("dash.super.reviewCosts")}
          onCtaClick={() => router.push("/admin/companies")}
        />
        {infraHealth?.latest && selectedVertical === "all" && (
          <AttentionCard
            tone={infraTone}
            icon={<DatabaseIcon size={14} />}
            value={
              <>
                {t("dash.super.infraHealthChunks", { count: infraHealth.latest.total_chunks.toLocaleString() })}
                {infraTrendLabel && <span className={styles.trendLabel}> {infraTrendLabel}</span>}
              </>
            }
            label={
              <>
                {tUpper("dash.super.infraHealth")}
                <Tooltip text={t("dash.super.infraHealthTooltip")}>
                  <InfoIcon size={12} />
                </Tooltip>
              </>
            }
            cta={t("dash.super.viewTrend")}
            onCtaClick={() => router.push("/admin/infra-health")}
          />
        )}
        <AttentionCard
          tone="success"
          icon={<BuildingIcon size={14} />}
          value={realActiveCompanies}
          label={
            <>
              {tUpper("dash.super.realActiveCompanies")}
              <Tooltip text={t("dash.super.realActiveCompaniesTooltip")}>
                <InfoIcon size={12} />
              </Tooltip>
            </>
          }
          cta={t("dash.super.viewCompanies")}
          onCtaClick={() => router.push("/admin/companies")}
        />
      </div>

      <div className={styles.analyticsRow}>
        <section className={`card ${styles.section} ${styles.chartCard}`}>
          <div className={styles.sectionHeader}>
            <h2>{t("dash.super.activity")}</h2>
          </div>
          <p className={styles.chartCaption}>{t("dash.super.activityCaption")}</p>
          <ActivityChart entries={scopedAuditLog} />
        </section>

        <section className={`card ${styles.section} ${styles.kbHealthPanel}`}>
          <div className={styles.sectionHeader}>
            <h2>{t("dash.super.chatKbPanel")}</h2>
            <button type="button" className={styles.sectionHeaderLink} onClick={() => router.push("/admin/feedback")}>
              {t("dash.super.viewFeedback")}
            </button>
          </div>
          {stats && (
            <>
              <div className={styles.kbHealthStats}>
                <div>
                  <span className={styles.value}>{totalMessages}</span>
                  <span className={styles.label}>{t("dash.super.totalMessages")}</span>
                </div>
                <div>
                  <span className={styles.value}>{activeDocumentsCount}</span>
                  <span className={styles.label}>
                    {t("dash.super.activeDocuments")}
                    <Tooltip text={t("dash.super.activeDocumentsTooltip")}>
                      <InfoIcon size={12} />
                    </Tooltip>
                  </span>
                </div>
              </div>
              {selectedVertical === "all" && (
                <QueriesByVerticalBars verticals={verticals} statsByVertical={statsByVertical} />
              )}
              <div className={styles.sentimentRow}>
                <SentimentDonut positive={positiveFeedback} negative={negativeFeedback} />
                <div>
                  <div className={styles.sentimentLabel}>{t("dash.super.sentiment")}</div>
                  <div className={styles.sentimentCaption}>
                    {totalFeedback === 0
                      ? t("dash.super.feedbackCaptionEmpty")
                      : t("dash.super.feedbackCaption", {
                          up: positiveFeedback,
                          down: negativeFeedback,
                        })}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <div className={`card ${styles.tenantsStrip}`}>
        <span className={styles.tenantsStripLabel}>{t("dash.super.companies")}</span>
        <div className={styles.tenantStats}>
          <div className={styles.tenantStat}>
            <span className={styles.value}>{scopedCompanies.length}</span>
            <span className={styles.label}>{t("dash.super.totalTenants")}</span>
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => router.push("/admin/companies")}>
          {t("dash.vertical.manageCompanies")}
        </button>
      </div>

      <section className={`card ${styles.section}`}>
        <div className={styles.tabBar}>
          {(
            [
              ["staleness", t("dash.super.tabStaleness")],
              ["languages", t("dash.super.languages")],
              ["audit", t("dash.super.tabAudit")],
            ] as [SecondaryTab, string][]
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "staleness" &&
          (scopedStaleDocs.length === 0 ? (
            <p className={styles.emptyState}>{t("dash.super.noStaleDocs")}</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{tUpper("dash.super.colTitle")}</th>
                  <th>{tUpper("dash.super.colSource")}</th>
                  <th>{tUpper("dash.super.colRegion")}</th>
                  <th>{tUpper("dash.super.colLastVerified")}</th>
                </tr>
              </thead>
              <tbody>
                {scopedStaleDocs.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.title}</td>
                    <td className="text-muted">{doc.source_group ?? "—"}</td>
                    <td className="text-muted">{doc.region_id ?? t("dash.super.national")}</td>
                    <td>
                      <span className="badge badge-warning">
                        {doc.last_verified_at ? new Date(doc.last_verified_at).toLocaleDateString() : t("dash.super.neverVerified")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {activeTab === "languages" && <LanguagesPanel />}

        {activeTab === "audit" &&
          (scopedAuditLog.length === 0 ? (
            <p className={styles.emptyState}>{t("dash.super.noActivity")}</p>
          ) : (
            <>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{tUpper("dash.super.colAction")}</th>
                    <th>{tUpper("dash.super.colCompany")}</th>
                    <th>{tUpper("dash.super.colResource")}</th>
                    <th>{tUpper("dash.super.colWhen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedAuditLog.slice(0, 8).map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.action}</td>
                      <td className="text-muted">
                        {entry.company_id ? companyNameById.get(entry.company_id) ?? `#${entry.company_id}` : t("dash.super.platform")}
                      </td>
                      <td className="text-muted">{entry.resource_type ?? "—"}</td>
                      <td className="text-muted">{new Date(entry.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-muted" style={{ marginTop: "var(--space-3)" }}>
                {t("dash.super.showingOf", { shown: Math.min(8, scopedAuditLog.length), total: scopedAuditLog.length })}
              </p>
            </>
          ))}
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { AlertIcon, ClockIcon, FlagIcon } from "../components/StatIcons";
import { TRANSLATION_KEYS, translations, type TranslationKey } from "../lib/translations";
import type { AdminStats, AuditLogEntry, CompanySummary, DocumentSummary, StaleDocumentSummary } from "../lib/types";
import { ActivityChart } from "./ActivityChart";
import { AttentionCard } from "./AttentionCard";
import { SentimentDonut } from "./SentimentDonut";
import styles from "./dashboard.module.css";

const COMPANY_TYPE_KEYS: Record<string, TranslationKey> = {
  construction: "register.typeConstruction",
  municipality: "register.typeMunicipality",
};

const BUILTIN_TRANSLATIONS = translations as Record<string, Partial<Record<TranslationKey, string>>>;

type SecondaryTab = "staleness" | "kb" | "languages" | "audit";

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
  const { t, locales, refreshLocales } = useLocale();
  const token = user?.token ?? null;

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

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
            <th>{t("dash.super.colCode")}</th>
            <th>{t("dash.super.colName")}</th>
            <th>{t("dash.super.colBuiltin")}</th>
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

      <form className={styles.inlineForm} onSubmit={addLocale} style={{ marginTop: "var(--space-4)" }}>
        <input
          className="input"
          placeholder={t("dash.super.localeCode")}
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          required
        />
        <input
          className="input"
          placeholder={t("dash.super.localeName")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
        />
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
  const { t } = useLocale();
  const router = useRouter();
  const token = user?.token ?? null;

  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [kbQuery, setKbQuery] = useState("");
  const [kbResults, setKbResults] = useState<DocumentSummary[]>([]);
  const [kbSearched, setKbSearched] = useState(false);

  const [staleDocs, setStaleDocs] = useState<StaleDocumentSummary[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);

  const [activeTab, setActiveTab] = useState<SecondaryTab>("staleness");

  async function refresh() {
    try {
      const [companiesData, auditData, staleData, statsData] = await Promise.all([
        api.get<CompanySummary[]>("/admin/companies", token),
        api.get<AuditLogEntry[]>("/admin/audit-log", token),
        api.get<StaleDocumentSummary[]>("/admin/stale-documents", token),
        api.get<AdminStats>("/admin/stats", token),
      ]);
      setCompanies(companiesData);
      setAuditLog(auditData);
      setStaleDocs(staleData);
      setStats(statsData);
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

  async function toggleSuspend(company: CompanySummary) {
    const action = company.is_suspended ? "unsuspend" : "suspend";
    await api.post(`/admin/companies/${company.id}/${action}`, undefined, token);
    refresh();
  }

  async function searchKb(e: React.FormEvent) {
    e.preventDefault();
    if (!kbQuery.trim()) return;
    setKbSearched(true);
    const results = await api.get<DocumentSummary[]>(`/admin/documents?q=${encodeURIComponent(kbQuery)}`, token);
    setKbResults(results);
  }

  async function removeDoc(id: number) {
    await api.post(`/admin/documents/${id}/remove`, undefined, token);
    setKbResults((prev) => prev.filter((d) => d.id !== id));
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  if (error) return <p className={styles.emptyState}>{error}</p>;

  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
  const constructionCount = companies.filter((c) => c.type === "construction").length;
  const municipalityCount = companies.filter((c) => c.type === "municipality").length;
  const suspendedCount = companies.filter((c) => c.is_suspended).length;

  const gapRate = stats?.gap_rate ?? 0;
  const gapTone = gapRate >= 50 ? "danger" : gapRate >= 20 ? "warning" : "success";
  const staleTone = staleDocs.length > 0 ? "warning" : "success";
  const suspendedTone = suspendedCount > 0 ? "danger" : "success";

  const totalFeedback = (stats?.positive_feedback ?? 0) + (stats?.negative_feedback ?? 0);

  return (
    <div>
      <div className={styles.overviewHeader}>
        <h1>{t("dash.super.title")}</h1>
        <p className={styles.overviewSubtitle}>{t("dash.super.subtitle")}</p>
      </div>

      <div className={styles.attentionRow}>
        <AttentionCard
          tone={suspendedTone}
          icon={<FlagIcon size={14} />}
          value={suspendedCount}
          label={t("dash.super.suspended")}
          cta={t("dash.super.manage")}
          onCtaClick={() => router.push("/admin/suspended-tenants")}
        />
        <AttentionCard
          tone={gapTone}
          icon={<AlertIcon size={14} />}
          value={`${gapRate}%`}
          label={t("dash.super.gapRate")}
          cta={t("dash.super.reviewGaps")}
          onCtaClick={() => router.push("/admin/chat-gap-rate")}
        />
        <AttentionCard
          tone={staleTone}
          icon={<ClockIcon size={14} />}
          value={staleDocs.length}
          label={t("dash.super.staleDocs")}
          cta={t("dash.super.reviewQueue")}
          onCtaClick={() => router.push("/admin/stale-documents")}
        />
      </div>

      <div className={styles.analyticsRow}>
        <section className={`card ${styles.section} ${styles.chartCard}`}>
          <div className={styles.sectionHeader}>
            <h2>{t("dash.super.activity")}</h2>
          </div>
          <p className={styles.chartCaption}>{t("dash.super.activityCaption")}</p>
          <ActivityChart entries={auditLog} />
        </section>

        <section className={`card ${styles.section} ${styles.kbHealthPanel}`}>
          <div className={styles.sectionHeader}>
            <h2>{t("dash.super.chatKbPanel")}</h2>
          </div>
          {stats && (
            <>
              <div className={styles.kbHealthStats}>
                <div>
                  <span className={styles.value}>{stats.total_messages}</span>
                  <span className={styles.label}>{t("dash.super.totalMessages")}</span>
                </div>
                <div>
                  <span className={styles.value}>{stats.active_documents}</span>
                  <span className={styles.label}>{t("dash.super.activeDocuments")}</span>
                </div>
              </div>
              <div className={styles.sentimentRow}>
                <SentimentDonut positive={stats.positive_feedback} negative={stats.negative_feedback} />
                <div>
                  <div className={styles.sentimentLabel}>{t("dash.super.sentiment")}</div>
                  <div className={styles.sentimentCaption}>
                    {totalFeedback === 0
                      ? t("dash.super.feedbackCaptionEmpty")
                      : t("dash.super.feedbackCaption", {
                          up: stats.positive_feedback,
                          down: stats.negative_feedback,
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
            <span className={styles.value}>{companies.length}</span>
            <span className={styles.label}>{t("dash.super.totalTenants")}</span>
          </div>
          <div className={styles.tenantStat}>
            <span className={styles.value}>{constructionCount}</span>
            <span className={styles.label}>{t("dash.super.constructionCompanies")}</span>
          </div>
          <div className={styles.tenantStat}>
            <span className={styles.value}>{municipalityCount}</span>
            <span className={styles.label}>{t("dash.super.municipalities")}</span>
          </div>
        </div>
      </div>

      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.super.companies")}</h2>
          <span className="text-muted">{t("dash.super.companiesTotal", { count: companies.length })}</span>
        </div>
        {companies.length === 0 ? (
          <p className={styles.emptyState}>{t("dash.super.noCompanies")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("dash.super.colName")}</th>
                <th>{t("dash.super.colType")}</th>
                <th>{t("dash.super.colStatus")}</th>
                <th>{t("dash.super.colCreated")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{COMPANY_TYPE_KEYS[c.type] ? t(COMPANY_TYPE_KEYS[c.type]) : c.type}</td>
                  <td>
                    <span className={`badge ${c.is_suspended ? "badge-danger" : "badge-success"}`}>
                      {c.is_suspended ? t("dash.super.statusSuspended") : t("dash.super.statusActive")}
                    </span>
                  </td>
                  <td className="text-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => toggleSuspend(c)}>
                      {c.is_suspended ? t("dash.super.unsuspend") : t("dash.super.suspend")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={`card ${styles.section}`}>
        <div className={styles.tabBar}>
          {(
            [
              ["staleness", t("dash.super.tabStaleness")],
              ["kb", t("dash.super.tabKb")],
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
          (staleDocs.length === 0 ? (
            <p className={styles.emptyState}>{t("dash.super.noStaleDocs")}</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("dash.super.colTitle")}</th>
                  <th>{t("dash.super.colSource")}</th>
                  <th>{t("dash.super.colRegion")}</th>
                  <th>{t("dash.super.colLastVerified")}</th>
                </tr>
              </thead>
              <tbody>
                {staleDocs.map((doc) => (
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

        {activeTab === "kb" && (
          <div>
            <form className={styles.inlineForm} onSubmit={searchKb}>
              <input
                className="input"
                placeholder={t("dash.super.kbPlaceholder")}
                value={kbQuery}
                onChange={(e) => setKbQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">
                {t("common.search")}
              </button>
            </form>

            {kbSearched && kbResults.length === 0 && <p className={styles.emptyState}>{t("common.noMatches")}</p>}

            {kbResults.length > 0 && (
              <table className={styles.table} style={{ marginTop: "var(--space-4)" }}>
                <thead>
                  <tr>
                    <th>{t("dash.super.colTitle")}</th>
                    <th>{t("dash.super.colType")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {kbResults.map((doc) => (
                    <tr key={doc.id}>
                      <td>{doc.title}</td>
                      <td>{doc.doc_type ? t(`docType.${doc.doc_type}` as TranslationKey) : "—"}</td>
                      <td>
                        <button className="btn btn-danger" onClick={() => removeDoc(doc.id)}>
                          {t("dash.super.remove")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "languages" && <LanguagesPanel />}

        {activeTab === "audit" &&
          (auditLog.length === 0 ? (
            <p className={styles.emptyState}>{t("dash.super.noActivity")}</p>
          ) : (
            <>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("dash.super.colAction")}</th>
                    <th>{t("dash.super.colCompany")}</th>
                    <th>{t("dash.super.colResource")}</th>
                    <th>{t("dash.super.colWhen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.slice(0, 8).map((entry) => (
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
                {t("dash.super.showingOf", { shown: Math.min(8, auditLog.length), total: auditLog.length })}
              </p>
            </>
          ))}
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { AlertIcon, BuildingIcon, ClockIcon, FlagIcon, HammerIcon, MailIcon, ShieldCheckIcon } from "../components/StatIcons";
import { TRANSLATION_KEYS, translations, type TranslationKey } from "../lib/translations";
import type { AdminStats, AuditLogEntry, CompanySummary, DocumentSummary, StaleDocumentSummary } from "../lib/types";
import { ActivityChart } from "./ActivityChart";
import { StatCard } from "./StatCard";
import styles from "./dashboard.module.css";

const COMPANY_TYPE_KEYS: Record<string, TranslationKey> = {
  construction: "register.typeConstruction",
  municipality: "register.typeMunicipality",
};

const BUILTIN_TRANSLATIONS = translations as Record<string, Partial<Record<TranslationKey, string>>>;

function groupTranslationKeys(): Record<string, TranslationKey[]> {
  const groups: Record<string, TranslationKey[]> = {};
  for (const key of TRANSLATION_KEYS) {
    const group = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "misc";
    (groups[group] ??= []).push(key);
  }
  return groups;
}

const TRANSLATION_GROUPS = groupTranslationKeys();

function LanguagesSection() {
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
    <section className={`card ${styles.section}`}>
      <div className={styles.sectionHeader}>
        <h2>{t("dash.super.languages")}</h2>
      </div>
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
    </section>
  );
}

export function SuperAdminDashboard() {
  const { user } = useAuth();
  const { t } = useLocale();
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

  return (
    <div>
      <h1>{t("dash.super.title")}</h1>

      <div className={styles.grid}>
        <StatCard tone="primary" icon={<BuildingIcon />} value={companies.length} label={t("dash.super.totalTenants")} />
        <StatCard tone="info" icon={<HammerIcon />} value={constructionCount} label={t("dash.super.constructionCompanies")} />
        <StatCard tone="purple" icon={<FlagIcon />} value={municipalityCount} label={t("dash.super.municipalities")} />
        <StatCard tone="danger" icon={<AlertIcon />} value={suspendedCount} label={t("dash.super.suspended")} />
      </div>

      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.super.ragStats")}</h2>
        </div>
        {stats && (
          <div className={styles.grid}>
            <StatCard tone="info" icon={<MailIcon />} value={stats.total_messages} label={t("dash.super.totalMessages")} />
            <StatCard tone="danger" icon={<AlertIcon />} value={`${stats.gap_rate}%`} label={t("dash.super.gapRate")} />
            <StatCard tone="primary" icon={<ShieldCheckIcon />} value={stats.active_documents} label={t("dash.super.activeDocuments")} />
            <StatCard tone="accent" icon={<ClockIcon />} value={stats.positive_feedback} label={t("dash.super.positiveFeedback")} />
            <StatCard tone="purple" icon={<ClockIcon />} value={stats.negative_feedback} label={t("dash.super.negativeFeedback")} />
          </div>
        )}
      </section>

      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.super.activity")}</h2>
        </div>
        <ActivityChart entries={auditLog} />
      </section>

      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.super.companies")}</h2>
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
        <div className={styles.sectionHeader}>
          <h2>{t("dash.super.staleDocs")}</h2>
        </div>
        {staleDocs.length === 0 ? (
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
        )}
      </section>

      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.super.kb")}</h2>
        </div>
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
      </section>

      <LanguagesSection />

      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.super.auditLog")}</h2>
        </div>
        {auditLog.length === 0 ? (
          <p className={styles.emptyState}>{t("dash.super.noActivity")}</p>
        ) : (
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
              {auditLog.slice(0, 20).map((entry) => (
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
        )}
      </section>
    </div>
  );
}

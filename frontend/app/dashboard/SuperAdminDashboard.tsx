"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { AuditLogEntry, CompanySummary, DocumentSummary } from "../lib/types";
import { ActivityChart } from "./ActivityChart";
import styles from "./dashboard.module.css";

const COMPANY_TYPE_KEYS: Record<string, TranslationKey> = {
  construction: "register.typeConstruction",
  municipality: "register.typeMunicipality",
};

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

  async function refresh() {
    try {
      const [companiesData, auditData] = await Promise.all([
        api.get<CompanySummary[]>("/admin/companies", token),
        api.get<AuditLogEntry[]>("/admin/audit-log", token),
      ]);
      setCompanies(companiesData);
      setAuditLog(auditData);
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
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{companies.length}</span>
          <span className={styles.statLabel}>{t("dash.super.totalTenants")}</span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{constructionCount}</span>
          <span className={styles.statLabel}>{t("dash.super.constructionCompanies")}</span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{municipalityCount}</span>
          <span className={styles.statLabel}>{t("dash.super.municipalities")}</span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{suspendedCount}</span>
          <span className={styles.statLabel}>{t("dash.super.suspended")}</span>
        </div>
      </div>

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

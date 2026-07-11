"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { useVertical } from "../lib/vertical";
import FieldError from "./FieldError";
import type {
  AdminStatsByVertical,
  CompanyCreateWithAdminRequest,
  CompanyCreateWithAdminResponse,
  CompanyDetail,
  CompanySummary,
  VerticalSummary,
} from "../lib/types";
import styles from "./CompaniesPanel.module.css";
import dashStyles from "../dashboard/dashboard.module.css";

const ACCENT_CLASS: Record<string, string> = {
  construction: styles.accentConstruction,
  tax_accounting: styles.accentTax,
};

export function CompaniesPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;
  const { selectedVertical } = useVertical();

  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [verticals, setVerticals] = useState<VerticalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [stats, setStats] = useState<AdminStatsByVertical | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdResult, setCreatedResult] = useState<CompanyCreateWithAdminResponse | null>(null);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const [companiesData, verticalsData, statsData] = await Promise.all([
        api.get<CompanySummary[]>("/admin/companies", token),
        api.get<VerticalSummary[]>("/admin/verticals", token),
        api.get<AdminStatsByVertical>("/admin/stats", token),
      ]);
      setCompanies(companiesData);
      setVerticals(verticalsData);
      setStats(statsData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const visibleCompanies =
    selectedVertical === "all" ? companies : companies.filter((c) => c.vertical_slug === selectedVertical);

  async function openDetail(company: CompanySummary) {
    if (!token) return;
    const data = await api.get<CompanyDetail>(`/admin/companies/${company.id}`, token);
    setDetail(data);
  }

  async function toggleSuspend(company: CompanySummary) {
    if (!token) return;
    const action = company.is_suspended ? "unsuspend" : "suspend";
    await api.post(`/admin/companies/${company.id}/${action}`, undefined, token);
    await refresh();
    if (detail && detail.id === company.id) {
      const data = await api.get<CompanyDetail>(`/admin/companies/${company.id}`, token);
      setDetail(data);
    }
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>{t("companies.title")}</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          + {t("companies.new")}
        </button>
      </div>

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        {visibleCompanies.length === 0 ? (
          <p className={dashStyles.emptyState}>{t("companies.empty")}</p>
        ) : (
          <table className={dashStyles.table}>
            <thead>
              <tr>
                <th>{t("companies.colName")}</th>
                <th>{t("companies.colVertical")}</th>
                <th>{t("companies.colProjects")}</th>
                <th>{t("companies.colUsers")}</th>
                <th>{t("companies.colCreated")}</th>
                <th>{t("companies.colStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleCompanies.map((c) => {
                const isDemo = c.name.toLowerCase().includes("demo");
                return (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      {isDemo && <span className={styles.demoPill}>{t("companies.demoPill")}</span>}
                    </td>
                    <td>
                      <span className={`${styles.verticalBadge} ${ACCENT_CLASS[c.vertical_slug ?? ""] ?? ""}`}>
                        {c.vertical_slug ? t(`vertical.${c.vertical_slug}` as TranslationKey) : "—"}
                      </span>
                    </td>
                    <td>{c.active_projects_count}</td>
                    <td>{c.active_users_count}</td>
                    <td className="text-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td>
                      <span className={`badge ${c.is_suspended ? "badge-danger" : "badge-success"}`}>
                        {c.is_suspended ? t("companies.statusSuspended") : t("companies.statusActive")}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-secondary" onClick={() => openDetail(c)}>
                        {t("companies.view")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {detail && (
        <CompanyDetailModal
          detail={detail}
          verticals={verticals}
          stats={stats}
          token={token}
          onClose={() => setDetail(null)}
          onToggleSuspend={() => toggleSuspend(detail)}
          onReassigned={async () => {
            await refresh();
            if (token) {
              const data = await api.get<CompanyDetail>(`/admin/companies/${detail.id}`, token);
              setDetail(data);
            }
          }}
        />
      )}

      {creating && (
        <CreateCompanyModal
          token={token}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setCreatedResult(result);
            refresh();
          }}
        />
      )}

      {createdResult && <CreatedAccountModal result={createdResult} onClose={() => setCreatedResult(null)} />}
    </div>
  );
}

function CreateCompanyModal({
  token,
  onClose,
  onCreated,
}: {
  token: string | null;
  onClose: () => void;
  onCreated: (result: CompanyCreateWithAdminResponse) => void;
}) {
  const { t } = useLocale();
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<CompanyCreateWithAdminRequest["company_type"]>("construction");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ companyName?: string; adminName?: string; adminEmail?: string }>({});

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!companyName.trim()) errors.companyName = t("validation.fieldRequired");
    if (!adminName.trim()) errors.adminName = t("validation.fieldRequired");
    if (!adminEmail.trim()) errors.adminEmail = t("validation.emailRequired");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<CompanyCreateWithAdminResponse>(
        "/admin/companies/create-with-admin",
        {
          company_name: companyName,
          company_type: companyType,
          admin_name: adminName,
          admin_email: adminEmail,
          admin_phone: adminPhone || undefined,
        },
        token
      );
      onCreated(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-company-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <div className={styles.modalHeader}>
          <h2 id="create-company-title" style={{ margin: 0 }}>
            {t("companies.new")}
          </h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("companies.new.cancel")}
          </button>
        </div>

        {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

        <div className={styles.modalSection}>
          <h4>{t("companies.new.sectionCompany")}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {t("companies.new.companyName")}
              <input
                className="input"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, companyName: undefined }));
                }}
                aria-invalid={!!fieldErrors.companyName}
              />
              {fieldErrors.companyName && <FieldError message={fieldErrors.companyName} />}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {t("companies.new.companyType")}
              <select
                className="input"
                value={companyType}
                onChange={(e) => setCompanyType(e.target.value as CompanyCreateWithAdminRequest["company_type"])}
              >
                <option value="construction">{t("companies.new.typeConstruction")}</option>
                <option value="accounting">{t("companies.new.typeAccounting")}</option>
                <option value="municipality">{t("companies.new.typeMunicipality")}</option>
              </select>
            </label>
          </div>
        </div>

        <div className={styles.modalSection}>
          <h4>{t("companies.new.sectionAdmin")}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {t("companies.new.adminName")}
              <input
                className="input"
                value={adminName}
                onChange={(e) => {
                  setAdminName(e.target.value);
                  if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, adminName: undefined }));
                }}
                aria-invalid={!!fieldErrors.adminName}
              />
              {fieldErrors.adminName && <FieldError message={fieldErrors.adminName} />}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {t("companies.new.adminEmail")}
              <input
                className="input"
                type="email"
                value={adminEmail}
                onChange={(e) => {
                  setAdminEmail(e.target.value);
                  if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, adminEmail: undefined }));
                }}
                aria-invalid={!!fieldErrors.adminEmail}
              />
              {fieldErrors.adminEmail && <FieldError message={fieldErrors.adminEmail} />}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {t("companies.new.adminPhone")}
              <input className="input" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} />
            </label>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            {t("companies.new.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? t("companies.new.creating") : t("companies.new.create")}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreatedAccountModal({ result, onClose }: { result: CompanyCreateWithAdminResponse; onClose: () => void }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  async function copyPassword() {
    await navigator.clipboard.writeText(result.generated_password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.modalScrim}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="created-account-title">
        <div className={styles.modalHeader}>
          <h2 id="created-account-title" style={{ margin: 0 }}>
            {t("companies.created.title")}
          </h2>
        </div>

        <div className={styles.modalSection}>
          <div className={styles.listRow}>
            <span>{t("companies.new.companyName")}</span>
            <strong>{result.company_name}</strong>
          </div>
          <div className={styles.listRow}>
            <span>{t("companies.new.adminName")}</span>
            <strong>
              {result.admin_name} ({result.admin_email})
            </strong>
          </div>
        </div>

        <div className={styles.modalSection}>
          <h4>{t("companies.created.password")}</h4>
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
              {result.generated_password}
            </code>
            <button type="button" className="btn btn-secondary" onClick={copyPassword}>
              {copied ? t("companies.created.copied") : t("companies.created.copy")}
            </button>
          </div>
          <p className={styles.reassignWarning} style={{ marginTop: "var(--space-3)" }}>
            {t("companies.created.warning")}
          </p>
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("companies.created.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompanyDetailModal({
  detail,
  verticals,
  stats,
  token,
  onClose,
  onToggleSuspend,
  onReassigned,
}: {
  detail: CompanyDetail;
  verticals: VerticalSummary[];
  stats: AdminStatsByVertical | null;
  token: string | null;
  onClose: () => void;
  onToggleSuspend: () => void;
  onReassigned: () => void;
}) {
  const { t } = useLocale();
  const [reassigning, setReassigning] = useState(false);
  const [newVerticalId, setNewVerticalId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);

  const currentVerticalEntry = stats?.by_vertical.find((v) => v.slug === detail.vertical_slug);
  const affectedDocs = currentVerticalEntry?.active_documents ?? 0;

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmingSuspend) setConfirmingSuspend(false);
      else if (reassigning) setReassigning(false);
      else onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [confirmingSuspend, reassigning, onClose]);

  function handleSuspendClick() {
    // Unsuspending isn't destructive - only gate the direction that locks
    // real users out immediately behind a confirmation.
    if (detail.is_suspended) onToggleSuspend();
    else setConfirmingSuspend(true);
  }

  async function confirmReassign() {
    if (!token || newVerticalId === "") return;
    setSubmitting(true);
    try {
      await api.post(`/admin/companies/${detail.id}/reassign-vertical`, { vertical_id: newVerticalId, confirmed: true }, token);
      setReassigning(false);
      onReassigned();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="company-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderTitle}>
            <h2 id="company-modal-title" style={{ margin: 0 }}>{detail.name}</h2>
            <span className={`${styles.verticalBadge} ${ACCENT_CLASS[detail.vertical_slug ?? ""] ?? ""}`}>
              {detail.vertical_slug ? t(`vertical.${detail.vertical_slug}` as TranslationKey) : "—"}
            </span>
          </div>
          <button className="btn btn-secondary" onClick={onClose}>
            {t("companies.modal.close")}
          </button>
        </div>

        <div className={styles.modalSection}>
          <h4>{t("companies.modal.info")}</h4>
          <p className="text-muted">
            {t("companies.modal.created")}: {new Date(detail.created_at).toLocaleDateString()}
          </p>
        </div>

        <div className={styles.modalSection}>
          <h4>{t("companies.modal.users")}</h4>
          {detail.users.length === 0 ? (
            <p className="text-muted">{t("companies.noUsers")}</p>
          ) : (
            detail.users.map((u) => (
              <div key={u.id} className={styles.listRow}>
                <span>{u.email}</span>
                <span className={styles.rolePill}>{t(`role.${u.role}` as TranslationKey)}</span>
              </div>
            ))
          )}
        </div>

        <div className={styles.modalSection}>
          <h4>{t("companies.modal.projects")}</h4>
          {detail.projects.length === 0 ? (
            <p className="text-muted">{t("companies.noProjects")}</p>
          ) : (
            detail.projects.map((p) => (
              <div key={p.id} className={styles.listRow}>
                <span>{p.name ?? "—"}</span>
                <span className="text-muted">{p.is_client ? t("companies.isClientTag") : p.municipality ?? "—"}</span>
              </div>
            ))
          )}
        </div>

        <div className={styles.modalSection}>
          <h4>{t("companies.modal.usage")}</h4>
          <div className={styles.usageStats}>
            <div className={styles.usageStat}>
              <span className={styles.usageValue}>{detail.messages_30d}</span>
              <span className={styles.usageLabel}>{t("companies.modal.messages30d")}</span>
            </div>
            <div className={styles.usageStat}>
              <span className={styles.usageValue}>{detail.gap_rate}%</span>
              <span className={styles.usageLabel}>{t("companies.modal.gapRate")}</span>
            </div>
          </div>

          <h4 style={{ marginTop: "var(--space-4)" }}>{t("companies.modal.tokenUsage")}</h4>
          <div className={styles.usageStats}>
            <div className={styles.usageStat}>
              <span className={styles.usageValue}>{detail.token_usage.total_tokens_30d.toLocaleString()}</span>
              <span className={styles.usageLabel}>
                {t("companies.modal.tokensBreakdown", {
                  prompt: detail.token_usage.prompt_tokens_30d.toLocaleString(),
                  completion: detail.token_usage.completion_tokens_30d.toLocaleString(),
                  total: detail.token_usage.total_tokens_30d.toLocaleString(),
                })}
              </span>
            </div>
            <div className={styles.usageStat}>
              <span className={styles.usageValue}>€{detail.token_usage.estimated_cost_eur_30d.toFixed(2)}</span>
              <span className={styles.usageLabel}>{t("companies.modal.estimatedCost")}</span>
            </div>
            <div className={styles.usageStat}>
              <span className={styles.usageValue}>{detail.token_usage.avg_tokens_per_message}</span>
              <span className={styles.usageLabel}>{t("companies.modal.avgPerMessage")}</span>
            </div>
          </div>

          {detail.token_usage.by_user.length > 0 && (
            <table className={dashStyles.table} style={{ width: "100%", marginTop: "var(--space-3)", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "4px 0" }}>{t("companies.modal.colUser")}</th>
                  <th style={{ textAlign: "left", padding: "4px 0" }}>{t("companies.modal.colMessages")}</th>
                  <th style={{ textAlign: "left", padding: "4px 0" }}>{t("companies.modal.colTokens")}</th>
                  <th style={{ textAlign: "left", padding: "4px 0" }}>{t("companies.modal.colCost")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.token_usage.by_user.map((u) => (
                  <tr key={u.user_id}>
                    <td style={{ padding: "4px 0" }}>{u.name}</td>
                    <td style={{ padding: "4px 0" }}>{u.message_count}</td>
                    <td style={{ padding: "4px 0" }}>{u.total_tokens_30d.toLocaleString()}</td>
                    <td style={{ padding: "4px 0" }}>€{u.estimated_cost_eur_30d.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="text-muted" style={{ fontSize: "0.75rem", marginTop: "var(--space-2)" }}>
            {t("companies.modal.costNote")}
          </p>
        </div>

        {reassigning && (
          <div className={styles.reassignWarning}>
            <p style={{ margin: 0 }}>{t("companies.reassign.warning", { count: affectedDocs })}</p>
            <select
              className="input"
              style={{ marginTop: "var(--space-3)" }}
              value={newVerticalId}
              onChange={(e) => setNewVerticalId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">{t("companies.reassign.selectVertical")}</option>
              {verticals
                .filter((v) => v.id !== detail.vertical_id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.display_name}
                  </option>
                ))}
            </select>
            <div className={styles.reassignActions}>
              <button className="btn btn-secondary" onClick={() => setReassigning(false)}>
                {t("companies.reassign.cancel")}
              </button>
              <button className="btn btn-primary" disabled={newVerticalId === "" || submitting} onClick={confirmReassign}>
                {t("companies.reassign.confirm")}
              </button>
            </div>
          </div>
        )}

        <div className={styles.modalFooter}>
          <button className="btn btn-secondary" onClick={() => setReassigning(true)}>
            {t("companies.modal.changeVertical")}
          </button>
          <button
            className={detail.is_suspended ? "btn btn-secondary" : "btn btn-danger"}
            onClick={handleSuspendClick}
          >
            {detail.is_suspended ? t("companies.modal.unsuspend") : t("companies.modal.suspend")}
          </button>
        </div>
      </div>

      {confirmingSuspend && (
        <div className={styles.modalScrim} onClick={(e) => { e.stopPropagation(); setConfirmingSuspend(false); }}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspend-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="suspend-confirm-title">{detail.name}</h2>
            <p style={{ color: "var(--admin-danger)" }}>{t("companies.suspendConfirm.warning")}</p>
            <div className={styles.reassignActions}>
              <button className="btn btn-secondary" onClick={() => setConfirmingSuspend(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn"
                style={{ background: "var(--admin-danger)", color: "#fff", borderColor: "var(--admin-danger)" }}
                onClick={() => {
                  setConfirmingSuspend(false);
                  onToggleSuspend();
                }}
              >
                {t("companies.suspendConfirm.confirmButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

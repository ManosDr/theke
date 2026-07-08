"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { useVertical } from "../lib/vertical";
import type { AdminStatsByVertical, CompanyDetail, CompanySummary, VerticalSummary } from "../lib/types";
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
      <h1>{t("companies.title")}</h1>

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

  const currentVerticalEntry = stats?.by_vertical.find((v) => v.slug === detail.vertical_slug);
  const affectedDocs = currentVerticalEntry?.active_documents ?? 0;

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
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderTitle}>
            <h2 style={{ margin: 0 }}>{detail.name}</h2>
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
            onClick={onToggleSuspend}
          >
            {detail.is_suspended ? t("companies.modal.unsuspend") : t("companies.modal.suspend")}
          </button>
        </div>
      </div>
    </div>
  );
}

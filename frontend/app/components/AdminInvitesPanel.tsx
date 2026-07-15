"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import dashStyles from "../dashboard/dashboard.module.css";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { AdminInviteSummary } from "../lib/types";
import type { TranslationKey } from "../lib/translations";

// Platform-wide equivalent of CompanyAdminDashboard's pending-invites list -
// every invite across every company (see Sidebar.tsx's "Προσκλήσεις" nav
// entry and GET /admin/invites), not just the caller's own.
export function AdminInvitesPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [invites, setInvites] = useState<AdminInviteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!token) return;
    try {
      const data = await api.get<AdminInviteSummary[]>("/admin/invites", token);
      setInvites(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load invites");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function revokeInvite(id: number) {
    try {
      await api.post(`/admin/invites/${id}/revoke`, undefined, token);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to revoke invite");
    }
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  if (error) return <p className={dashStyles.emptyState}>{error}</p>;

  const pending = invites.filter((i) => i.status === "pending");
  const resolved = invites.filter((i) => i.status !== "pending");

  return (
    <div>
      <h1>{t("nav.invites")}</h1>

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={dashStyles.sectionHeader}>
          <h2>{t("dash.company.pendingInvitesHeading")}</h2>
        </div>
        {pending.length === 0 ? (
          <p className={dashStyles.emptyState}>—</p>
        ) : (
          <table className={dashStyles.table}>
            <thead>
              <tr>
                <th>{t("dash.company.colEmail")}</th>
                <th>{t("dash.super.colCompany")}</th>
                <th>{t("dash.company.colRole")}</th>
                <th>{t("dash.company.colCreated")}</th>
                <th>{t("dash.company.colExpires")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>{inv.company_name}</td>
                  <td>{t(`role.${inv.role}` as TranslationKey)}</td>
                  <td className="text-muted">{new Date(inv.created_at).toLocaleDateString()}</td>
                  <td className="text-muted">{new Date(inv.expires_at).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => revokeInvite(inv.id)}>
                      {t("dash.company.cancelInvite")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {resolved.length > 0 && (
        <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
          <div className={dashStyles.sectionHeader}>
            <h2>{t("dash.company.colStatus")}</h2>
          </div>
          <table className={`${dashStyles.table} ${dashStyles.tableCompact}`}>
            <thead>
              <tr>
                <th>{t("dash.company.colEmail")}</th>
                <th>{t("dash.super.colCompany")}</th>
                <th>{t("dash.company.colRole")}</th>
                <th>{t("dash.company.colStatus")}</th>
                <th>{t("dash.company.colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>{inv.company_name}</td>
                  <td>{t(`role.${inv.role}` as TranslationKey)}</td>
                  <td>
                    <span className={`badge ${inv.status === "accepted" ? "badge-success" : "badge-danger"}`}>
                      {inv.status === "accepted" ? t("invite.statusAccepted") : t("invite.statusRevoked")}
                    </span>
                  </td>
                  <td className="text-muted">{new Date(inv.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

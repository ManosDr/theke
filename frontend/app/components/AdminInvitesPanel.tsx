"use client";

import { useEffect, useState } from "react";

import FieldError from "./FieldError";
import { ApiError, api } from "../lib/api";
import dashStyles from "../dashboard/dashboard.module.css";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { AdminInviteSummary, InviteSummary, SuperAdminInviteCreateRequest } from "../lib/types";
import type { TranslationKey } from "../lib/translations";

// Platform-wide equivalent of CompanyAdminDashboard's pending-invites list -
// every invite across every company (see Sidebar.tsx's "Προσκλήσεις" nav
// entry and GET /admin/invites), not just the caller's own.
export function AdminInvitesPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const token = user?.token ?? null;

  const [invites, setInvites] = useState<AdminInviteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCompanyType, setInviteCompanyType] = useState<"construction" | "municipality" | "accounting">(
    "construction"
  );
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [justResentId, setJustResentId] = useState<number | null>(null);

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

  async function resendInvite(id: number) {
    setResendingId(id);
    try {
      await api.post(`/admin/invites/${id}/resend`, undefined, token);
      setJustResentId(id);
      setTimeout(() => setJustResentId((cur) => (cur === id ? null : cur)), 3000);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to resend invite");
    } finally {
      setResendingId(null);
    }
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      setInviteEmailError(t("validation.emailRequired"));
      return;
    }
    setInviteEmailError(null);
    setInviteSent(false);
    setCreating(true);
    try {
      const payload: SuperAdminInviteCreateRequest = { email: inviteEmail, company_type: inviteCompanyType };
      await api.post<InviteSummary>("/admin/invites", payload, token);
      setInviteEmail("");
      setInviteSent(true);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to create invite");
    } finally {
      setCreating(false);
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
          <h2>{t("adminInvites.createHeading")}</h2>
        </div>
        <p className="text-muted" style={{ marginTop: 0 }}>
          {t("adminInvites.createDescription")}
        </p>
        <form className={dashStyles.inlineForm} onSubmit={createInvite} noValidate>
          <div>
            <input
              type="email"
              className="input"
              placeholder={t("dash.company.inviteEmailPlaceholder")}
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                if (e.target.value.trim()) setInviteEmailError(null);
              }}
              aria-invalid={!!inviteEmailError}
            />
            {inviteEmailError && <FieldError message={inviteEmailError} />}
          </div>
          <select
            className="input"
            value={inviteCompanyType}
            onChange={(e) => setInviteCompanyType(e.target.value as "construction" | "municipality" | "accounting")}
            style={{ width: "auto" }}
          >
            <option value="construction">{t("register.typeConstruction")}</option>
            <option value="municipality">{t("register.typeMunicipality")}</option>
            <option value="accounting">{t("register.typeAccounting")}</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {t("dash.company.sendInvite")}
          </button>
        </form>
        {inviteSent && <p className="text-muted">{t("adminInvites.inviteSent")}</p>}
      </section>

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
                <th>{tUpper("dash.company.colEmail")}</th>
                <th>{tUpper("dash.super.colCompany")}</th>
                <th>{tUpper("dash.company.colRole")}</th>
                <th>{tUpper("dash.company.colCreated")}</th>
                <th>{tUpper("dash.company.colExpires")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>{inv.company_name ?? <span className="text-muted">{t("adminInvites.pendingCompanyLess")}</span>}</td>
                  <td>{t(`role.${inv.role}` as TranslationKey)}</td>
                  <td className="text-muted">{new Date(inv.created_at).toLocaleDateString()}</td>
                  <td className="text-muted">{new Date(inv.expires_at).toLocaleDateString()}</td>
                  <td style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => resendInvite(inv.id)}
                      disabled={resendingId === inv.id}
                    >
                      {justResentId === inv.id ? t("dash.company.inviteResent") : t("dash.company.resendInvite")}
                    </button>
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
                <th>{tUpper("dash.company.colEmail")}</th>
                <th>{tUpper("dash.super.colCompany")}</th>
                <th>{tUpper("dash.company.colRole")}</th>
                <th>{tUpper("dash.company.colStatus")}</th>
                <th>{tUpper("dash.company.colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>{inv.company_name ?? <span className="text-muted">{t("adminInvites.pendingCompanyLess")}</span>}</td>
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

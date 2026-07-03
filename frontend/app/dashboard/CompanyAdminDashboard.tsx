"use client";

import { useEffect, useRef, useState } from "react";

import { API_URL, ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { ClockIcon, MailIcon, ShieldCheckIcon, UsersIcon } from "../components/StatIcons";
import type { AuditLogEntry, InviteSummary, MyCompanySummary, RemovalRequestSummary, UserSummary } from "../lib/types";
import { ActivityChart } from "./ActivityChart";
import { StatCard } from "./StatCard";
import styles from "./dashboard.module.css";

export function CompanyAdminDashboard() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [company, setCompany] = useState<MyCompanySummary | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [removalRequests, setRemovalRequests] = useState<RemovalRequestSummary[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [newInviteToken, setNewInviteToken] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoStatus, setLogoStatus] = useState<string | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);

  async function refresh() {
    try {
      const [usersData, invitesData, removalData, auditData, companyData] = await Promise.all([
        api.get<UserSummary[]>("/companies/me/users", token),
        api.get<InviteSummary[]>("/companies/me/invites", token),
        api.get<RemovalRequestSummary[]>("/documents/removal-requests", token),
        api.get<AuditLogEntry[]>("/companies/me/audit-log", token),
        api.get<MyCompanySummary>("/companies/me", token),
      ]);
      setUsers(usersData);
      setInvites(invitesData);
      setRemovalRequests(removalData);
      setAuditLog(auditData);
      setCompany(companyData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load company data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeRole(target: UserSummary, role: "admin" | "member") {
    try {
      await api.patch(`/companies/me/users/${target.id}/role`, { role }, token);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to change role");
    }
  }

  async function toggleActive(target: UserSummary) {
    const action = target.is_active ? "revoke" : "restore";
    try {
      await api.post(`/companies/me/users/${target.id}/${action}`, undefined, token);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : `Failed to ${action} access`);
    }
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setNewInviteToken(null);
    try {
      const invite = await api.post<InviteSummary>(
        "/companies/me/invites",
        { email: inviteEmail, role: inviteRole },
        token
      );
      setNewInviteToken(invite.token);
      setInviteEmail("");
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to create invite");
    }
  }

  async function revokeInvite(id: number) {
    await api.post(`/companies/me/invites/${id}/revoke`, undefined, token);
    refresh();
  }

  async function decideRemoval(id: number, decision: "approve" | "reject") {
    await api.post(`/documents/removal-requests/${id}/${decision}`, undefined, token);
    refresh();
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      await api.upload("/companies/me/logo", formData, token);
      setLogoStatus(t("dash.company.logoUpdated"));
      setLogoVersion((v) => v + 1);
      refresh();
    } catch (err) {
      setLogoStatus(err instanceof ApiError ? err.message : "Failed to upload logo");
    } finally {
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function removeLogo() {
    try {
      await api.del("/companies/me/logo", token);
      setLogoStatus(t("dash.company.logoRemoved"));
      setLogoVersion((v) => v + 1);
      refresh();
    } catch (err) {
      setLogoStatus(err instanceof ApiError ? err.message : "Failed to remove logo");
    }
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  if (error) return <p className={styles.emptyState}>{error}</p>;

  const activeUsers = users.filter((u) => u.is_active).length;
  const pendingRemovals = removalRequests.filter((r) => r.status === "pending");

  return (
    <div>
      <h1>
        {company?.type === "municipality"
          ? t("dash.company.titleMunicipality", { name: company.name })
          : t("dash.company.title")}
      </h1>

      <div className={styles.grid}>
        <StatCard tone="primary" icon={<UsersIcon />} value={users.length} label={t("dash.company.teamMembers")} />
        <StatCard tone="info" icon={<ShieldCheckIcon />} value={activeUsers} label={t("dash.company.activeAccess")} />
        <StatCard
          tone={pendingRemovals.length > 0 ? "accent" : "primary"}
          icon={<ClockIcon />}
          value={pendingRemovals.length}
          label={t("dash.company.pendingApprovals")}
        />
        <StatCard
          tone="purple"
          icon={<MailIcon />}
          value={invites.filter((i) => i.status === "pending").length}
          label={t("dash.company.pendingInvites")}
        />
      </div>

      <div className={styles.twoCol}>
        <div>
          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{t("dash.company.activity")}</h2>
            </div>
            <ActivityChart entries={auditLog} />
          </section>

          {pendingRemovals.length > 0 && (
            <section className={`card ${styles.section}`}>
              <div className={styles.sectionHeader}>
                <h2>{t("dash.company.pendingRemovals")}</h2>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("dash.company.colDocument")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRemovals.map((r) => (
                    <tr key={r.id}>
                      <td>{r.document_title ?? `Document #${r.document_id}`}</td>
                      <td className={styles.rowActions}>
                        <button className="btn btn-primary" onClick={() => decideRemoval(r.id, "approve")}>
                          {t("dash.company.approve")}
                        </button>
                        <button className="btn btn-secondary" onClick={() => decideRemoval(r.id, "reject")}>
                          {t("dash.company.reject")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{t("dash.company.team")}</h2>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("dash.company.colEmail")}</th>
                  <th>{t("dash.company.colRole")}</th>
                  <th>{t("dash.company.colStatus")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="input"
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value as "admin" | "member")}
                        style={{ width: "auto" }}
                      >
                        <option value="admin">{t("role.admin")}</option>
                        <option value="member">{t("role.member")}</option>
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${u.is_active ? "badge-success" : "badge-danger"}`}>
                        {u.is_active ? t("dash.company.statusActive") : t("dash.company.statusRevoked")}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-secondary" onClick={() => toggleActive(u)}>
                        {u.is_active ? t("dash.company.revoke") : t("dash.company.restore")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div>
          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{t("dash.company.inviteTeammate")}</h2>
            </div>
            <form className={styles.inlineForm} onSubmit={createInvite}>
              <input
                className="input"
                type="email"
                placeholder={t("dash.company.inviteEmailPlaceholder")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <select
                className="input"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                style={{ width: "auto" }}
              >
                <option value="member">{t("role.member")}</option>
                <option value="admin">{t("role.admin")}</option>
              </select>
              <button type="submit" className="btn btn-primary">
                {t("dash.company.sendInvite")}
              </button>
            </form>

            {newInviteToken && (
              <div className={styles.tokenBox}>
                {t("dash.company.shareInviteCode")} <br />
                {newInviteToken}
              </div>
            )}

            {invites.length > 0 && (
              <table className={styles.table} style={{ marginTop: "var(--space-4)" }}>
                <thead>
                  <tr>
                    <th>{t("dash.company.colEmail")}</th>
                    <th>{t("dash.company.colStatus")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.email}</td>
                      <td>
                        <span
                          className={`badge ${
                            inv.status === "accepted"
                              ? "badge-success"
                              : inv.status === "revoked"
                                ? "badge-danger"
                                : "badge-warning"
                          }`}
                        >
                          {inv.status === "accepted"
                            ? t("dash.company.inviteAccepted")
                            : inv.status === "revoked"
                              ? t("dash.company.inviteRevoked")
                              : t("dash.company.invitePending")}
                        </span>
                      </td>
                      <td>
                        {inv.status === "pending" && (
                          <button className="btn btn-secondary" onClick={() => revokeInvite(inv.id)}>
                            {t("dash.company.revoke")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{t("dash.company.logo")}</h2>
            </div>
            {company?.has_logo && (
              <img
                src={`${API_URL}/companies/${company.id}/logo?v=${logoVersion}`}
                alt={t("dash.company.logoAlt", { name: company.name })}
                className={styles.logoPreview}
              />
            )}
            <div className={styles.logoControls}>
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo} />
              {company?.has_logo && (
                <button className="btn btn-danger" onClick={removeLogo}>
                  {t("dash.company.removeLogo")}
                </button>
              )}
            </div>
            {logoStatus && <p className="text-muted" style={{ marginTop: "var(--space-2)" }}>{logoStatus}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

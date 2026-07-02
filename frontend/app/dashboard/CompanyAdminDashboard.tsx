"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AuditLogEntry, InviteSummary, RemovalRequestSummary, UserSummary } from "../lib/types";
import { ActivityChart } from "./ActivityChart";
import styles from "./dashboard.module.css";

export function CompanyAdminDashboard() {
  const { user } = useAuth();
  const token = user?.token ?? null;

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

  async function refresh() {
    try {
      const [usersData, invitesData, removalData, auditData] = await Promise.all([
        api.get<UserSummary[]>("/companies/me/users", token),
        api.get<InviteSummary[]>("/companies/me/invites", token),
        api.get<RemovalRequestSummary[]>("/documents/removal-requests", token),
        api.get<AuditLogEntry[]>("/companies/me/audit-log", token),
      ]);
      setUsers(usersData);
      setInvites(invitesData);
      setRemovalRequests(removalData);
      setAuditLog(auditData);
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
      setLogoStatus("Logo updated.");
    } catch (err) {
      setLogoStatus(err instanceof ApiError ? err.message : "Failed to upload logo");
    }
  }

  if (loading) return <p className="text-muted">Loading dashboard…</p>;
  if (error) return <p className={styles.emptyState}>{error}</p>;

  const activeUsers = users.filter((u) => u.is_active).length;
  const pendingRemovals = removalRequests.filter((r) => r.status === "pending");

  return (
    <div>
      <h1>{user?.companyType === "municipality" ? "Municipality dashboard" : "Company dashboard"}</h1>

      <div className={styles.grid}>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{users.length}</span>
          <span className={styles.statLabel}>Team members</span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{activeUsers}</span>
          <span className={styles.statLabel}>Active access</span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{pendingRemovals.length}</span>
          <span className={styles.statLabel}>Pending approvals</span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{invites.filter((i) => i.status === "pending").length}</span>
          <span className={styles.statLabel}>Pending invites</span>
        </div>
      </div>

      <div className={styles.twoCol}>
        <div>
          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>Activity (last 14 days)</h2>
            </div>
            <ActivityChart entries={auditLog} />
          </section>

          {pendingRemovals.length > 0 && (
            <section className={`card ${styles.section}`}>
              <div className={styles.sectionHeader}>
                <h2>Pending document removals</h2>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRemovals.map((r) => (
                    <tr key={r.id}>
                      <td>{r.document_title ?? `Document #${r.document_id}`}</td>
                      <td className={styles.rowActions}>
                        <button className="btn btn-primary" onClick={() => decideRemoval(r.id, "approve")}>
                          Approve
                        </button>
                        <button className="btn btn-secondary" onClick={() => decideRemoval(r.id, "reject")}>
                          Reject
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
              <h2>Team</h2>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
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
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${u.is_active ? "badge-success" : "badge-danger"}`}>
                        {u.is_active ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-secondary" onClick={() => toggleActive(u)}>
                        {u.is_active ? "Revoke" : "Restore"}
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
              <h2>Invite a teammate</h2>
            </div>
            <form className={styles.inlineForm} onSubmit={createInvite}>
              <input
                className="input"
                type="email"
                placeholder="email@example.com"
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
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" className="btn btn-primary">
                Send invite
              </button>
            </form>

            {newInviteToken && (
              <div className={styles.tokenBox}>
                Share this invite code: <br />
                {newInviteToken}
              </div>
            )}

            {invites.length > 0 && (
              <table className={styles.table} style={{ marginTop: "var(--space-4)" }}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
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
                          {inv.status}
                        </span>
                      </td>
                      <td>
                        {inv.status === "pending" && (
                          <button className="btn btn-secondary" onClick={() => revokeInvite(inv.id)}>
                            Revoke
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
              <h2>Company logo</h2>
            </div>
            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo} />
            {logoStatus && <p className="text-muted" style={{ marginTop: "var(--space-2)" }}>{logoStatus}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

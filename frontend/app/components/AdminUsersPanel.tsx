"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, api } from "../lib/api";
import dashStyles from "../dashboard/dashboard.module.css";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { AdminUserSummary } from "../lib/types";

// Platform-wide equivalent of CompanyAdminDashboard's UsersTab - every user
// across every company, not just the caller's own (see Sidebar.tsx's
// "Χρήστες" nav entry and GET /admin/users). Reuses dashboard.module.css's
// table/section styles so this reads as the same screen family as the
// company-admin's own Χρήστες tab, just without the company scoping.
export function AdminUsersPanel() {
  const { user, impersonateAsUser } = useAuth();
  const { t, tUpper } = useLocale();
  const router = useRouter();
  const token = user?.token ?? null;

  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!token) return;
    try {
      const data = await api.get<AdminUserSummary[]>("/admin/users", token);
      setUsers(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function changeRole(target: AdminUserSummary, role: "admin" | "member") {
    try {
      await api.patch(`/admin/users/${target.id}/role`, { role }, token);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to change role");
    }
  }

  async function toggleActive(target: AdminUserSummary) {
    const action = target.is_active ? "revoke" : "restore";
    try {
      await api.post(`/admin/users/${target.id}/${action}`, undefined, token);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : `Failed to ${action} access`);
    }
  }

  async function viewAs(target: AdminUserSummary) {
    try {
      await impersonateAsUser(target.id);
      router.push("/dashboard");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to switch account");
    }
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  if (error) return <p className={dashStyles.emptyState}>{error}</p>;

  return (
    <div>
      <h1>{t("nav.users")}</h1>

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        {users.length === 0 ? (
          <p className={dashStyles.emptyState}>{t("companies.noUsers")}</p>
        ) : (
          <table className={dashStyles.table}>
            <thead>
              <tr>
                <th>{tUpper("dash.company.colName")}</th>
                <th>{tUpper("dash.company.colEmail")}</th>
                <th>{tUpper("dash.super.colCompany")}</th>
                <th>{tUpper("dash.company.colRole")}</th>
                <th>{tUpper("dash.company.colLastLogin")}</th>
                <th>{tUpper("dash.company.colMessages30d")}</th>
                <th>{tUpper("dash.company.colStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.first_name || u.last_name ? `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() : "—"}</td>
                  <td>{u.email}</td>
                  <td>{u.company_name}</td>
                  <td>
                    {u.role === "super_admin" ? (
                      t("role.super_admin")
                    ) : (
                      <select
                        className="input"
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value as "admin" | "member")}
                        style={{ width: "auto" }}
                      >
                        <option value="admin">{t("role.admin")}</option>
                        <option value="member">{t("role.member")}</option>
                      </select>
                    )}
                  </td>
                  <td className="text-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                  <td>{u.messages_30d}</td>
                  <td>
                    <span className={`badge ${u.is_active ? "badge-success" : "badge-danger"}`}>
                      {u.is_active ? t("dash.company.statusActive") : t("dash.company.statusRevoked")}
                    </span>
                  </td>
                  <td style={{ display: "flex", gap: "var(--space-2)" }}>
                    {u.role !== "super_admin" && u.is_active && (
                      <button className="btn btn-secondary" onClick={() => viewAs(u)}>
                        {t("dash.company.viewAs")}
                      </button>
                    )}
                    {u.role !== "super_admin" && (
                      <button className="btn btn-secondary" onClick={() => toggleActive(u)}>
                        {u.is_active ? t("dash.company.revoke") : t("dash.company.restore")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

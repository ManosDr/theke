"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, api } from "../lib/api";
import dashStyles from "../dashboard/dashboard.module.css";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { AdminUserSummary, CompanySummary, EmailStatusResponse, VerticalSummary } from "../lib/types";
import ResetPasswordModal from "./ResetPasswordModal";
import styles from "./AdminUsersPanel.module.css";

type Tab = "real" | "demo";
type StatusFilter = "all" | "active" | "revoked";

// Platform-wide equivalent of CompanyAdminDashboard's UsersTab - every user
// across every company, not just the caller's own (see Sidebar.tsx's
// "Χρήστες" nav entry and GET /admin/users). Reuses dashboard.module.css's
// table/section styles so this reads as the same screen family as the
// company-admin's own Χρήστες tab, just without the company scoping.
//
// Split into a real-users tab and a demo-accounts tab (AdminUserSummary's
// is_test_account, surfaced from the owning Company - see KNOWN_DECISIONS.md)
// so that "View as" impersonation - a meaningful trust boundary - is only
// ever offered next to accounts that were seeded for internal testing, not
// as a casual one-click action against a real user's account.
export function AdminUsersPanel() {
  const { user, impersonateAsUser } = useAuth();
  const { t, tUpper } = useLocale();
  const router = useRouter();
  const token = user?.token ?? null;

  const [tab, setTab] = useState<Tab>("real");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [verticals, setVerticals] = useState<VerticalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState<number | "">("");
  const [verticalFilter, setVerticalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserSummary | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(false);

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

  useEffect(() => {
    if (!token) return;
    api.get<CompanySummary[]>("/admin/companies", token).then(setCompanies).catch(() => setCompanies([]));
    api.get<VerticalSummary[]>("/admin/verticals", token).then(setVerticals).catch(() => setVerticals([]));
    api
      .get<EmailStatusResponse>("/admin/email-status", token)
      .then((res) => setEmailEnabled(res.email_enabled))
      .catch(() => setEmailEnabled(false));
  }, [token]);

  const byTab = useMemo(() => users.filter((u) => (tab === "demo" ? u.is_test_account : !u.is_test_account)), [users, tab]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return byTab.filter((u) => {
      if (query) {
        const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.toLowerCase();
        if (!name.includes(query) && !u.email.toLowerCase().includes(query)) return false;
      }
      if (roleFilter && u.role !== roleFilter) return false;
      if (companyFilter !== "" && u.company_id !== companyFilter) return false;
      if (verticalFilter && u.vertical_slug !== verticalFilter) return false;
      if (statusFilter === "active" && !u.is_active) return false;
      if (statusFilter === "revoked" && u.is_active) return false;
      return true;
    });
  }, [byTab, q, roleFilter, companyFilter, verticalFilter, statusFilter]);

  const hasFilters = Boolean(q || roleFilter || companyFilter !== "" || verticalFilter || statusFilter !== "all");

  function clearFilters() {
    setQ("");
    setRoleFilter("");
    setCompanyFilter("");
    setVerticalFilter("");
    setStatusFilter("all");
  }

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
    setOpenMenuId(null);
    try {
      await api.post(`/admin/users/${target.id}/${action}`, undefined, token);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : `Failed to ${action} access`);
    }
  }

  async function viewAs(target: AdminUserSummary) {
    setOpenMenuId(null);
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

      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "real"}
          className={`${styles.tabButton} ${tab === "real" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("real")}
        >
          {t("adminUsers.tabReal")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "demo"}
          className={`${styles.tabButton} ${tab === "demo" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("demo")}
        >
          {t("adminUsers.tabDemo")}
        </button>
      </div>

      <div className={`card ${styles.filterBar}`}>
        <input
          className={`input ${styles.searchInput}`}
          type="text"
          placeholder={t("adminUsers.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">{t("adminUsers.filterRole")}</option>
          <option value="super_admin">{t("role.super_admin")}</option>
          <option value="admin">{t("role.admin")}</option>
          <option value="member">{t("role.member")}</option>
        </select>

        <select
          className="input"
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">{t("adminUsers.filterCompany")}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select className="input" value={verticalFilter} onChange={(e) => setVerticalFilter(e.target.value)}>
          <option value="">{t("docs.filterVertical")}</option>
          {verticals.map((v) => (
            <option key={v.id} value={v.slug}>
              {v.display_name}
            </option>
          ))}
        </select>

        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">{t("docs.filterStatus")}</option>
          <option value="active">{t("dash.company.statusActive")}</option>
          <option value="revoked">{t("dash.company.statusRevoked")}</option>
        </select>

        {hasFilters && (
          <button type="button" className={styles.clearFilters} onClick={clearFilters}>
            {t("docs.clearFilters")}
          </button>
        )}
      </div>

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        {filtered.length === 0 ? (
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
              {filtered.map((u) => (
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
                  <td className={styles.rowMenuWrap}>
                    {u.role !== "super_admin" && (
                      <>
                        <button
                          type="button"
                          className={styles.rowMenuButton}
                          aria-label={t("companies.modal.menuActionsFor", { email: u.email })}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === u.id}
                          onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                        >
                          ⋯
                        </button>
                        {openMenuId === u.id && (
                          <div className={styles.rowMenu} role="menu">
                            {tab === "demo" && u.is_active && (
                              <button className={styles.rowMenuItem} onClick={() => viewAs(u)}>
                                {t("dash.company.viewAs")}
                              </button>
                            )}
                            <button
                              className={styles.rowMenuItem}
                              onClick={() => {
                                setResetTarget(u);
                                setOpenMenuId(null);
                              }}
                            >
                              {t("companies.modal.resetPassword")}
                            </button>
                            {u.company_id != null && (
                              <button
                                className={styles.rowMenuItem}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  router.push(`/admin/companies?company=${u.company_id}`);
                                }}
                              >
                                {t("adminUsers.menuUsage")}
                              </button>
                            )}
                            <button className={styles.rowMenuItem} onClick={() => toggleActive(u)}>
                              {u.is_active ? t("dash.company.revoke") : t("dash.company.restore")}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          token={token}
          emailEnabled={emailEnabled}
          endpoint={`/admin/users/${resetTarget.id}/reset-password`}
          onClose={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}

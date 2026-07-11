"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import {
  ClockIcon,
  CoinIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "../components/StatIcons";
import { DocumentsIcon } from "../components/NavIcons";
import FieldError from "../components/FieldError";
import type {
  ActivityEventEntry,
  CompanyDocumentSummary,
  CompanyOverviewResponse,
  CustomerDetailResponse,
  CustomerSummary,
  InviteSummary,
  KbSourceStatusEntry,
  MyCompanySummary,
  ProjectSummary,
  RemovalRequestSummary,
  TokenUsageSummary,
  UserSummary,
} from "../lib/types";
import { StatCard } from "./StatCard";
import styles from "./dashboard.module.css";
import tabStyles from "./CompanyAdminDashboard.module.css";

const TABS = ["overview", "users", "documents", "customers"] as const;
type Tab = (typeof TABS)[number];

function timeAgo(iso: string, locale: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const isGreek = locale.startsWith("el");
  if (diffMin < 1) return isGreek ? "τώρα" : "just now";
  if (diffMin < 60) return `${diffMin}${isGreek ? "λ" : "m"}`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}${isGreek ? "ω" : "h"}`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}${isGreek ? "η" : "d"}`;
}

const EVENT_ICON: Record<ActivityEventEntry["type"], string> = {
  chat_message: "💬",
  document_uploaded: "📄",
  project_created: "🏗",
  customer_added: "👤",
  user_joined: "✉",
};

export function CompanyAdminDashboard() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [tab, setTab] = useState<Tab>("overview");
  const [company, setCompany] = useState<MyCompanySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api
      .get<MyCompanySummary>("/companies/me", token)
      .then(setCompany)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load company"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  if (error) return <p className={styles.emptyState}>{error}</p>;

  return (
    <div className={tabStyles.wrapper}>
      <div className={tabStyles.header}>
        <h1>
          {company?.type === "municipality"
            ? t("dash.company.titleMunicipality", { name: company.name })
            : t("dash.company.title")}
        </h1>
      </div>

      <div className={tabStyles.tabBar} role="tablist">
        {TABS.map((tKey) => (
          <button
            key={tKey}
            type="button"
            role="tab"
            aria-selected={tab === tKey}
            className={`${tabStyles.tabButton} ${tab === tKey ? tabStyles.tabButtonActive : ""}`}
            onClick={() => setTab(tKey)}
          >
            {t(`dash.company.tab${tKey.charAt(0).toUpperCase() + tKey.slice(1)}` as TranslationKey)}
          </button>
        ))}
      </div>

      <div className={tabStyles.tabContent}>
        {tab === "overview" && <OverviewTab token={token} onNavigateToUsers={() => setTab("users")} />}
        {tab === "users" && <UsersTab token={token} />}
        {tab === "documents" && <DocumentsTab token={token} />}
        {tab === "customers" && <CustomersTab token={token} />}
      </div>
    </div>
  );
}

function OverviewTab({ token, onNavigateToUsers }: { token: string | null; onNavigateToUsers: () => void }) {
  const { t, locale } = useLocale();
  const [data, setData] = useState<CompanyOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<TokenUsageSummary | null>(null);

  useEffect(() => {
    if (!token) return;
    api.get<CompanyOverviewResponse>("/companies/me/overview", token).then(setData).finally(() => setLoading(false));
    api.get<TokenUsageSummary>("/companies/me/usage", token).then(setUsage).catch(() => setUsage(null));
  }, [token]);

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  if (!data) return null;

  const topUsers = usage ? [...usage.by_user].sort((a, b) => b.total_tokens_30d - a.total_tokens_30d).slice(0, 10) : [];

  return (
    <div className={tabStyles.scrollPane}>
      <div className={styles.grid}>
        <StatCard
          tone="primary"
          icon={<UsersIcon />}
          value={`${data.users_total}`}
          label={`${t("dash.company.statUsers")} · ${t("dash.company.statUsersSub", { active: data.users_active_30d })}`}
        />
        <StatCard
          tone="info"
          icon={<ShieldCheckIcon />}
          value={`${data.messages_30d}`}
          label={t("dash.company.statChatSub", { count: data.messages_30d, rate: data.gap_rate })}
        />
        <StatCard
          tone="accent"
          icon={<ClockIcon />}
          value={`${data.customers_total}/${data.projects_total}`}
          label={t("dash.company.statCustomersProjectsSub", { customers: data.customers_total, projects: data.projects_total })}
        />
        <StatCard
          tone="purple"
          icon={<DocumentsIcon />}
          value={`${data.private_documents_count}/${data.public_documents_count}`}
          label={t("dash.company.statDocumentsSub", { private: data.private_documents_count, public: data.public_documents_count })}
        />
        <StatCard
          tone="danger"
          icon={<CoinIcon />}
          value={data.total_tokens_30d.toLocaleString()}
          label={`${t("dash.company.statTokens")} · €${data.estimated_cost_eur_30d.toFixed(2)}`}
        />
      </div>

      {topUsers.length > 0 && (
        <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
          <div className={styles.sectionHeader}>
            <h2>{t("dash.company.usageByUser")}</h2>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("dash.company.usageColUser")}</th>
                <th>{t("dash.company.usageColMessages")}</th>
                <th>{t("dash.company.usageColTokens")}</th>
                <th>{t("dash.company.usageColCost")}</th>
              </tr>
            </thead>
            <tbody>
              {topUsers.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.name}</td>
                  <td>{u.message_count}</td>
                  <td>{u.total_tokens_30d.toLocaleString()}</td>
                  <td>€{u.estimated_cost_eur_30d.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={onNavigateToUsers}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              marginTop: "var(--space-3)",
              color: "var(--color-link)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("dash.company.usageSeeAll")}
          </button>
        </section>
      )}

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.company.activity")}</h2>
        </div>
        {data.activity.length === 0 ? (
          <p className={styles.emptyState}>{t("dash.company.activityEmpty")}</p>
        ) : (
          <ul className={tabStyles.activityList}>
            {data.activity.map((ev, i) => (
              <li key={i} className={tabStyles.activityItem}>
                <span className={tabStyles.activityIcon}>{EVENT_ICON[ev.type]}</span>
                <span className={tabStyles.activityDesc}>
                  {ev.actor_name ? (
                    <>
                      <strong>{ev.actor_name}</strong> {t(`dash.company.event.${ev.type}` as TranslationKey)}
                      {ev.description ? `: ${ev.description}` : ""}
                    </>
                  ) : (
                    <>
                      {t(`dash.company.event.${ev.type}` as TranslationKey)}
                      {ev.description ? `: ${ev.description}` : ""}
                    </>
                  )}
                </span>
                <span className={tabStyles.activityTime}>{timeAgo(ev.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function UsersTab({ token }: { token: string | null }) {
  const { t } = useLocale();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [newInviteToken, setNewInviteToken] = useState<string | null>(null);
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);

  async function refresh() {
    if (!token) return;
    const [usersData, invitesData] = await Promise.all([
      api.get<UserSummary[]>("/companies/me/users", token),
      api.get<InviteSummary[]>("/companies/me/invites", token),
    ]);
    setUsers(usersData);
    setInvites(invitesData);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
    if (!inviteEmail.trim()) {
      setInviteEmailError(t("validation.emailRequired"));
      return;
    }
    setInviteEmailError(null);
    setNewInviteToken(null);
    try {
      const invite = await api.post<InviteSummary>("/companies/me/invites", { email: inviteEmail, role: inviteRole }, token);
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

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  const pendingInvites = invites.filter((i) => i.status === "pending");

  return (
    <div className={tabStyles.scrollPane}>
      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.company.inviteTeammate")}</h2>
        </div>
        <form className={styles.inlineForm} onSubmit={createInvite} noValidate>
          <div>
            <input
              className="input"
              type="email"
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
          <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "admin" | "member")} style={{ width: "auto" }}>
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
      </section>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.company.team")}</h2>
        </div>
        {users.length === 0 ? (
          <p className={styles.emptyState}>{t("companies.noUsers")}</p>
        ) : (
          <table className={`${styles.table} ${styles.tableCompact}`}>
            <thead>
              <tr>
                <th>{t("dash.company.colName")}</th>
                <th>{t("dash.company.colEmail")}</th>
                <th>{t("dash.company.colPhone")}</th>
                <th>{t("dash.company.colRole")}</th>
                <th>{t("dash.company.colLastLogin")}</th>
                <th>{t("dash.company.colMessages30d")}</th>
                <th>{t("dash.company.colStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name ?? "—"}</td>
                  <td>{u.email}</td>
                  <td>{u.phone ?? "—"}</td>
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
                  <td className="text-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                  <td>{u.messages_30d}</td>
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
        )}
      </section>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.company.pendingInvitesHeading")}</h2>
        </div>
        {pendingInvites.length === 0 ? (
          <p className={styles.emptyState}>—</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("dash.company.colEmail")}</th>
                <th>{t("dash.company.colRole")}</th>
                <th>{t("dash.company.colCreated")}</th>
                <th>{t("dash.company.colExpires")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
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
    </div>
  );
}

function DocumentsTab({ token }: { token: string | null }) {
  const { t } = useLocale();
  const [docs, setDocs] = useState<CompanyDocumentSummary[]>([]);
  const [sources, setSources] = useState<KbSourceStatusEntry[]>([]);
  const [removalRequests, setRemovalRequests] = useState<RemovalRequestSummary[]>([]);
  const [firstProjectId, setFirstProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!token) return;
    const [docsData, sourcesData, removalData, projectsData] = await Promise.all([
      api.get<CompanyDocumentSummary[]>("/companies/me/documents", token),
      api.get<KbSourceStatusEntry[]>("/companies/me/kb-status", token),
      api.get<RemovalRequestSummary[]>("/documents/removal-requests", token),
      api.get<ProjectSummary[]>("/projects", token),
    ]);
    setDocs(docsData);
    setSources(sourcesData);
    setRemovalRequests(removalData);
    setFirstProjectId(projectsData[0]?.id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function deleteDoc(d: CompanyDocumentSummary) {
    if (!d.project_id) return;
    await api.del(`/projects/${d.project_id}/documents/${d.id}`, token);
    refresh();
  }

  async function decideRemoval(id: number, decision: "approve" | "reject") {
    await api.post(`/documents/removal-requests/${id}/${decision}`, undefined, token);
    refresh();
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;
  const pendingRemovals = removalRequests.filter((r) => r.status === "pending");

  return (
    <div className={tabStyles.scrollPane}>
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

      <section className={`card ${styles.section}`} style={{ marginTop: pendingRemovals.length > 0 ? "var(--space-4)" : 0 }}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.company.privateDocs")}</h2>
        </div>
        <p className="text-muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          {t("project.company.documentsHint")}
          {firstProjectId != null && (
            <>
              {" "}
              <Link href={`/projects/${firstProjectId}`}>{t("project.company.documentsHintLink")}</Link>
            </>
          )}
        </p>
        {docs.length === 0 ? (
          <p className={styles.emptyState}>{t("dash.company.noDocuments")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("dash.company.colDocument")}</th>
                <th>{t("dash.company.colProject")}</th>
                <th>{t("dash.company.colType")}</th>
                <th>{t("dash.company.colExtraction")}</th>
                <th>{t("dash.company.colDate")}</th>
                <th>{t("dash.company.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.title ?? "—"}</td>
                  <td>{d.project_name ?? "—"}</td>
                  <td>
                    <span className="badge badge-success">
                      {d.doc_type ? t(`docType.${d.doc_type}` as TranslationKey) : "—"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${d.extraction_status === "full_text" ? "badge-success" : "badge-warning"}`}>
                      {d.extraction_status ? t(`docs.status.${d.extraction_status}` as TranslationKey) : "—"}
                    </span>
                  </td>
                  <td className="text-muted">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => deleteDoc(d)}>
                      {t("dash.company.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={`card ${styles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.sectionHeader}>
          <h2>{t("dash.company.publicKb")}</h2>
        </div>
        {sources.length === 0 ? (
          <p className={styles.emptyState}>{t("dash.company.noSources")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("dash.company.colSource")}</th>
                <th>{t("dash.company.colDocCount")}</th>
                <th>{t("dash.company.colLastSync")}</th>
                <th>{t("dash.company.colNextSync")}</th>
                <th>{t("dash.company.colHealth")}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s, i) => (
                <tr key={i}>
                  <td>{s.source_name}</td>
                  <td>{s.document_count}</td>
                  <td className="text-muted">{s.last_crawled_at ? new Date(s.last_crawled_at).toLocaleDateString() : "—"}</td>
                  <td className="text-muted">{s.next_crawl_at ? new Date(s.next_crawl_at).toLocaleDateString() : "—"}</td>
                  <td>
                    <span
                      className={`badge ${s.health === "healthy" ? "badge-success" : s.health === "failed" ? "badge-danger" : "badge-warning"}`}
                    >
                      {t(`adminSources.health.${s.health}` as TranslationKey)}
                    </span>
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

function CustomersTab({ token }: { token: string | null }) {
  const { t } = useLocale();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, CustomerDetailResponse | undefined>>({});
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAfm, setNewAfm] = useState("");
  const [newNameError, setNewNameError] = useState<string | null>(null);

  async function refresh() {
    if (!token) return;
    const data = await api.get<CustomerSummary[]>("/customers", token);
    setCustomers(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggleExpand(c: CustomerSummary) {
    if (expanded[c.id]) {
      setExpanded((prev) => ({ ...prev, [c.id]: undefined }));
      return;
    }
    const detail = await api.get<CustomerDetailResponse>(`/customers/${c.id}`, token);
    setExpanded((prev) => ({ ...prev, [c.id]: detail }));
  }

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      setNewNameError(t("validation.fieldRequired"));
      return;
    }
    setNewNameError(null);
    if (!token) return;
    await api.post("/customers", { name: newName.trim(), afm: newAfm.trim() || undefined }, token);
    setNewName("");
    setNewAfm("");
    setCreating(false);
    refresh();
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div className={tabStyles.scrollPane}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--space-3)" }}>
        <button type="button" className="btn btn-primary" onClick={() => setCreating((c) => !c)}>
          + {t("dash.company.newCustomer")}
        </button>
      </div>

      {creating && (
        <form className={styles.inlineForm} onSubmit={createCustomer} style={{ marginBottom: "var(--space-4)" }} noValidate>
          <div>
            <input
              className="input"
              placeholder={t("account.name")}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (e.target.value.trim()) setNewNameError(null);
              }}
              aria-invalid={!!newNameError}
            />
            {newNameError && <FieldError message={newNameError} />}
          </div>
          <input className="input" placeholder={t("dash.company.colAfm")} value={newAfm} onChange={(e) => setNewAfm(e.target.value)} />
          <button type="submit" className="btn btn-primary">
            {t("common.save")}
          </button>
        </form>
      )}

      <section className={`card ${styles.section}`}>
        {customers.length === 0 ? (
          <p className={styles.emptyState}>{t("dash.company.noCustomers")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("dash.company.colName")}</th>
                <th>{t("dash.company.colAfm")}</th>
                <th>{t("dash.company.colPhone")}</th>
                <th>{t("dash.company.colEmail")}</th>
                <th>{t("dash.company.colProjectsCount")}</th>
                <th>{t("dash.company.colLastProject")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <Fragment key={c.id}>
                  <tr onClick={() => toggleExpand(c)} style={{ cursor: "pointer" }}>
                    <td>{c.name}</td>
                    <td>{c.afm ?? "—"}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td>{c.email ?? "—"}</td>
                    <td>{c.project_count}</td>
                    <td className="text-muted">{c.last_project_at ? new Date(c.last_project_at).toLocaleDateString() : "—"}</td>
                    <td>{expanded[c.id] ? "▾" : "▸"}</td>
                  </tr>
                  {expanded[c.id] && (
                    <tr key={`${c.id}-detail`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <div className={tabStyles.subTableWrap}>
                          {expanded[c.id]!.projects.length === 0 ? (
                            <p className="text-muted" style={{ padding: "var(--space-3)" }}>
                              {t("companies.noProjects")}
                            </p>
                          ) : (
                            <table className={styles.table}>
                              <thead>
                                <tr>
                                  <th>{t("dash.company.colName")}</th>
                                  <th>{t("dash.company.colProject")}</th>
                                  <th>{t("dash.company.colCreated")}</th>
                                  <th>{t("dash.company.colDocCount")}</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {expanded[c.id]!.projects.map((p) => (
                                  <tr key={p.id}>
                                    <td>{p.name ?? "—"}</td>
                                    <td>{p.region_name_el ?? t("project.detail.customer")}</td>
                                    <td className="text-muted">{new Date(p.created_at).toLocaleDateString()}</td>
                                    <td>{p.document_count}</td>
                                    <td>
                                      <Link href={`/projects/${p.id}`} className="btn btn-secondary">
                                        {t("dash.company.viewProject")}
                                      </Link>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

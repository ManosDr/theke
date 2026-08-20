"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import { SortableTh } from "./SortableTh";
import { useSortableData } from "../lib/useSortableData";
import type { AdminStatsByVertical, GapDiscoveryResult, GapQueryEntry, GapSourceCandidateEntry } from "../lib/types";
import dashStyles from "../dashboard/dashboard.module.css";
import styles from "./ChatGapRatePanel.module.css";

type StatusFilter = "all" | "unreviewed" | "addressed";

function GapSourceCandidateRow({
  candidate,
  token,
  onResolved,
  onNotified,
}: {
  candidate: GapSourceCandidateEntry;
  token: string | null;
  onResolved: () => void;
  onNotified: () => void;
}) {
  const { t } = useLocale();
  const [title, setTitle] = useState(candidate.candidate_title ?? "");
  const [content, setContent] = useState(candidate.candidate_content ?? "");
  const [sourceUrl, setSourceUrl] = useState(candidate.source_url);
  const [authority, setAuthority] = useState(candidate.authority ?? "");
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectNote, setShowRejectNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/admin/gap-source-candidates/${candidate.id}/confirm`,
        { title, content, source_url: sourceUrl, authority: authority || null },
        token
      );
      onResolved();
    } catch {
      setError(t("admin.chatGapRate.candidates.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/gap-source-candidates/${candidate.id}/reject`, { review_note: rejectNote || null }, token);
      onResolved();
    } catch {
      setError(t("admin.chatGapRate.candidates.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function notifyUser() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/gap-source-candidates/${candidate.id}/notify-user`, {}, token);
      onNotified();
    } catch {
      setError(t("admin.chatGapRate.candidates.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (candidate.status === "confirmed") {
    return (
      <div className={styles.candidateCard}>
        <div className={styles.candidateHeader}>
          <span className="badge status-addressed">{t("admin.chatGapRate.candidates.statusConfirmed")}</span>
          <a href={candidate.source_url} target="_blank" rel="noreferrer" className="text-muted">
            {candidate.source_url}
          </a>
        </div>
        <p className={styles.candidateQuestion}>{candidate.question}</p>
        {error && <p style={{ color: "var(--color-danger)", fontSize: "0.82rem" }}>{error}</p>}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={notifyUser}>
          {t("admin.chatGapRate.candidates.notifyUser")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.candidateCard}>
      <div className={styles.candidateHeader}>
        <span className={`badge ${styles["status-unreviewed"]}`}>
          {t("admin.chatGapRate.candidates.statusPending")}
        </span>
        {candidate.confidence && (
          <span className="text-muted" style={{ fontSize: "0.78rem" }}>
            {t("admin.chatGapRate.candidates.confidence")}: {candidate.confidence}
          </span>
        )}
      </div>
      <p className={styles.candidateQuestion}>{candidate.question}</p>
      <label className={styles.candidateField}>
        {t("admin.chatGapRate.candidates.fieldTitle")}
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={styles.candidateField}>
        {t("admin.chatGapRate.candidates.fieldContent")}
        <textarea className="input" rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
      </label>
      <label className={styles.candidateField}>
        {t("admin.chatGapRate.candidates.fieldSourceUrl")}
        <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      </label>
      <label className={styles.candidateField}>
        {t("admin.chatGapRate.candidates.fieldAuthority")}
        <input className="input" value={authority} onChange={(e) => setAuthority(e.target.value)} />
      </label>
      {error && <p style={{ color: "var(--color-danger)", fontSize: "0.82rem" }}>{error}</p>}
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
          {t("admin.chatGapRate.candidates.confirm")}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setShowRejectNote((v) => !v)}>
          {t("admin.chatGapRate.candidates.reject")}
        </button>
      </div>
      {showRejectNote && (
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
          <input
            className="input"
            placeholder={t("admin.chatGapRate.candidates.rejectNotePlaceholder")}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={reject}>
            {t("admin.chatGapRate.candidates.confirmReject")}
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatGapRatePanel() {
  const { user } = useAuth();
  const { t, tUpper, locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = user?.token ?? null;

  // Deep-link scope (see CompaniesPanel's modal, the Business Health gap
  // chart, and the dashboard gap-rate tile: every place an aggregate
  // gap-rate percentage is shown links here with ?company_id=/?user_id= so
  // "66.7%" always comes with an obvious next click to what actually
  // failed). Read once - a real navigation (not just local state) is what
  // changes the scope, matching CompaniesPanel's own ?company= pattern.
  const scopeCompanyId = searchParams.get("company_id");
  const scopeUserId = searchParams.get("user_id");
  const isScoped = Boolean(scopeCompanyId || scopeUserId);

  const [stats, setStats] = useState<AdminStatsByVertical | null>(null);
  const [queries, setQueries] = useState<GapQueryEntry[]>([]);
  const [candidates, setCandidates] = useState<GapSourceCandidateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unreviewed");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [discoveringId, setDiscoveringId] = useState<number | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);

  function loadCandidates() {
    if (!token) return Promise.resolve();
    return api.get<GapSourceCandidateEntry[]>("/admin/gap-source-candidates?status=all", token).then((all) =>
      setCandidates(all.filter((c) => c.status === "pending_review" || (c.status === "confirmed" && !c.notified_at)))
    );
  }

  function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (scopeCompanyId) params.set("company_id", scopeCompanyId);
    if (scopeUserId) params.set("user_id", scopeUserId);
    const qs = params.toString();
    return Promise.all([
      api.get<AdminStatsByVertical>("/admin/stats", token),
      api.get<GapQueryEntry[]>(`/admin/gap-queries${qs ? `?${qs}` : ""}`, token),
      loadCandidates(),
    ]).then(([statsData, gapData]) => {
      setStats(statsData);
      setQueries(gapData);
    });
  }

  useEffect(() => {
    // A deep-linked visit is investigative ("why is this company/user at
    // 66.7%?") - default to showing everything, not just what's still
    // outstanding, so the full picture is visible without an extra click.
    if (isScoped) setStatusFilter("all");
    load()?.finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, scopeCompanyId, scopeUserId]);

  const scopeLabel = isScoped ? (queries[0]?.company_name ?? queries[0]?.user_name ?? null) : null;

  function clearScope() {
    router.push("/admin/chat-gap-rate");
  }

  const filteredQueries = queries.filter((q) => {
    if (statusFilter === "unreviewed" && q.addressed) return false;
    if (statusFilter === "addressed" && !q.addressed) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      q.message.toLowerCase().includes(s) ||
      (q.company_name ?? "").toLowerCase().includes(s) ||
      (q.user_name ?? "").toLowerCase().includes(s)
    );
  });
  const {
    sorted: sortedQueries,
    sortColumn,
    sortDirection,
    toggleSort,
  } = useSortableData(filteredQueries, (q, column) => {
    switch (column) {
      case "company":
        return q.company_name ?? null;
      case "user":
        return q.user_name ?? null;
      case "when":
        return parseApiDate(q.created_at).getTime();
      case "status":
        return q.addressed ? 1 : 0;
      default:
        return null;
    }
  });

  async function updateStatus(id: number, addressed: boolean) {
    const updated = await api.patch<GapQueryEntry>(`/admin/gap-queries/${id}`, { addressed }, token);
    setQueries((prev) => prev.map((q) => (q.id === id ? updated : q)));
    setOpenMenuId(null);
  }

  async function discoverSource(id: number) {
    setOpenMenuId(null);
    setDiscoveringId(id);
    setDiscoveryMessage(null);
    try {
      const result = await api.post<GapDiscoveryResult>(`/admin/gap-queries/${id}/discover-source`, {}, token);
      if (result.candidate) {
        setCandidates((prev) => [result.candidate as GapSourceCandidateEntry, ...prev]);
        setDiscoveryMessage(t("admin.chatGapRate.candidates.foundOne"));
      } else {
        setDiscoveryMessage(t("admin.chatGapRate.candidates.foundNone"));
      }
    } catch {
      setDiscoveryMessage(t("admin.chatGapRate.candidates.searchFailed"));
    } finally {
      setDiscoveringId(null);
    }
  }

  return (
    <div>
      <h1>{t("admin.chatGapRate.title")}</h1>
      <p className="text-muted">{t("admin.chatGapRate.description")}</p>

      {stats && !isScoped && (
        <p style={{ marginTop: "var(--space-2)", fontWeight: 600, color: "var(--color-danger)" }}>
          {t("admin.chatGapRate.currentRate")}: {stats.total.gap_rate}%
        </p>
      )}

      {isScoped && (
        <div className={styles.scopeChip}>
          <span>
            {t("admin.chatGapRate.scopedTo", { name: scopeLabel ?? t("admin.chatGapRate.scopedToUnknown") })}
          </span>
          <button type="button" className={styles.scopeClear} onClick={clearScope}>
            {t("admin.chatGapRate.clearScope")}
          </button>
        </div>
      )}

      {candidates.length > 0 && (
        <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
          <div className={dashStyles.sectionHeader}>
            <h2>{t("admin.chatGapRate.candidates.title")}</h2>
          </div>
          <p className="text-muted" style={{ marginBottom: "var(--space-3)" }}>
            {t("admin.chatGapRate.candidates.hint")}
          </p>
          <div className={styles.candidateList}>
            {candidates.map((c) => (
              <GapSourceCandidateRow
                key={c.id}
                candidate={c}
                token={token}
                onResolved={() => loadCandidates()}
                onNotified={() => loadCandidates()}
              />
            ))}
          </div>
        </section>
      )}

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <div className={dashStyles.sectionHeader}>
          <h2>{t("admin.chatGapRate.recentGaps")}</h2>
        </div>
        <p className="text-muted" style={{ marginBottom: "var(--space-3)" }}>
          {t("admin.chatGapRate.recentGapsHint")}
        </p>
        {discoveryMessage && (
          <p className="text-muted" style={{ marginBottom: "var(--space-3)" }}>
            {discoveryMessage}
          </p>
        )}
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : queries.length === 0 ? (
          <p className={dashStyles.emptyState}>
            {isScoped ? t("admin.chatGapRate.noGapsScoped") : t("admin.chatGapRate.noGaps")}
          </p>
        ) : (
          <>
            <div className={styles.filterBar}>
              <div className={styles.searchField}>
                <input
                  className="input"
                  type="text"
                  placeholder={t("admin.chatGapRate.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <label className={styles.filterField}>
                {tUpper("admin.chatGapRate.filterStatus")}
                <select
                  className="input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                >
                  <option value="all">{t("admin.chatGapRate.filterAll")}</option>
                  <option value="unreviewed">{t("admin.chatGapRate.status.unreviewed")}</option>
                  <option value="addressed">{t("admin.chatGapRate.status.addressed")}</option>
                </select>
              </label>
            </div>
            {sortedQueries.length === 0 ? (
              <p className={dashStyles.emptyState}>{t("admin.chatGapRate.noResults")}</p>
            ) : (
              <table className={dashStyles.table}>
                <thead>
                  <tr>
                    <th>{tUpper("admin.chatGapRate.colQuestion")}</th>
                    <SortableTh label={tUpper("dash.super.colCompany")} column="company" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("admin.chatGapRate.colUser")} column="user" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("dash.super.colWhen")} column="when" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <SortableTh label={tUpper("admin.chatGapRate.colStatus")} column="status" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
                    <th>{tUpper("admin.chatGapRate.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedQueries.map((q) => (
                    <tr key={q.id}>
                      <td>{q.message}</td>
                      <td className="text-muted">{q.company_name ?? t("dash.super.platform")}</td>
                      <td className="text-muted">{q.user_name ?? "—"}</td>
                      <td className="text-muted">{parseApiDate(q.created_at).toLocaleString(locale)}</td>
                      <td>
                        <span
                          className={`badge ${styles[q.addressed ? "status-addressed" : "status-unreviewed"]}`}
                          title={q.addressed_at ? parseApiDate(q.addressed_at).toLocaleString(locale) : undefined}
                        >
                          {t(q.addressed ? "admin.chatGapRate.status.addressed" : "admin.chatGapRate.status.unreviewed")}
                        </span>
                      </td>
                      <td className={styles.rowMenuWrap}>
                        <button
                          type="button"
                          className={styles.rowMenuButton}
                          aria-label={t("admin.chatGapRate.menuActionsFor", { id: q.id })}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === q.id}
                          disabled={discoveringId === q.id}
                          onClick={() => setOpenMenuId(openMenuId === q.id ? null : q.id)}
                        >
                          {discoveringId === q.id ? "…" : "⋯"}
                        </button>
                        {openMenuId === q.id && (
                          <div className={styles.rowMenu} role="menu">
                            {q.addressed ? (
                              <button className={styles.rowMenuItem} onClick={() => updateStatus(q.id, false)}>
                                {t("admin.chatGapRate.markUnreviewed")}
                              </button>
                            ) : (
                              <button className={styles.rowMenuItem} onClick={() => updateStatus(q.id, true)}>
                                {t("admin.chatGapRate.markAddressed")}
                              </button>
                            )}
                            <button className={styles.rowMenuItem} onClick={() => discoverSource(q.id)}>
                              {t("admin.chatGapRate.discoverSource")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import { GapResolutionModal } from "./GapResolutionModal";
import { RowMenu } from "./RowMenu";
import { SortableTh } from "./SortableTh";
import { InfoIcon } from "./StatIcons";
import Tooltip from "./Tooltip";
import { useSortableData } from "../lib/useSortableData";
import type {
  AdminStatsByVertical,
  GapQueryEntry,
  GapRecheckAllResponse,
  GapRecheckStatusResponse,
  GapSourceCandidateEntry,
} from "../lib/types";
import dashStyles from "../dashboard/dashboard.module.css";
import styles from "./ChatGapRatePanel.module.css";

type StatusFilter = "all" | "unreviewed" | "addressed";

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
  // Confirmed candidates still awaiting a notify/don't-notify decision -
  // NOT pending_review ones, which only exist transiently while a modal
  // session is open (see discoverSource below - each "discover source"
  // click now starts a fresh search inside the modal rather than staging a
  // row a separate page section has to track).
  const [pendingDecisions, setPendingDecisions] = useState<GapSourceCandidateEntry[]>([]);
  // pending_review candidates staged by "Επανέλεγχος όλων"'s external-search
  // fallback (or left over from a manual "Αναζήτηση πηγής" whose modal was
  // closed before Confirm/Reject) - never auto-confirmed, same discipline
  // as every candidate created tonight.
  const [needsReview, setNeedsReview] = useState<GapSourceCandidateEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Επανέλεγχος όλων - same live-progress bulk-run pattern as Sync All /
  // DocumentsPanel's bulk revalidation.
  const [recheckRunning, setRecheckRunning] = useState(false);
  const [recheckTotal, setRecheckTotal] = useState(0);
  const [recheckStatus, setRecheckStatus] = useState<GapRecheckStatusResponse | null>(null);
  const [recheckComplete, setRecheckComplete] = useState<{ recovered: number; stillGap: number } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unreviewed");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  // Drives the resolution modal - either a fresh search (query set,
  // pendingCandidate null) or resuming an already-confirmed candidate that
  // still needs a notify decision (pendingCandidate set).
  const [activeQuery, setActiveQuery] = useState<{ id: number; message: string } | null>(null);
  const [activePendingCandidate, setActivePendingCandidate] = useState<GapSourceCandidateEntry | null>(null);

  function loadPendingDecisions() {
    if (!token) return Promise.resolve();
    return api.get<GapSourceCandidateEntry[]>("/admin/gap-source-candidates?status=confirmed", token).then((all) =>
      setPendingDecisions(all.filter((c) => !c.notified_at && !c.notify_skipped_at))
    );
  }

  function loadNeedsReview() {
    if (!token) return Promise.resolve();
    return api
      .get<GapSourceCandidateEntry[]>("/admin/gap-source-candidates?status=pending_review", token)
      .then(setNeedsReview);
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
      loadPendingDecisions(),
      loadNeedsReview(),
    ]).then(([statsData, gapData]) => {
      setStats(statsData);
      setQueries(gapData);
    });
  }

  async function runRecheckAll() {
    if (!token) return;
    const data = await api.post<GapRecheckAllResponse>("/admin/gap-queries/recheck-all", undefined, token);
    setRecheckTotal(data.queued);
    setRecheckComplete(null);
    if (data.queued > 0) setRecheckRunning(true);
  }

  useEffect(() => {
    if (!recheckRunning || !token) return;
    const interval = setInterval(async () => {
      const data = await api.get<GapRecheckStatusResponse>("/admin/gap-queries/recheck-all/status", token);
      setRecheckStatus(data);
      if (data.pending === 0) {
        setRecheckRunning(false);
        setRecheckComplete({ recovered: data.recovered, stillGap: data.still_gap });
        load();
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recheckRunning, token]);

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

  function discoverSource(q: GapQueryEntry) {
    setOpenMenuId(null);
    setActivePendingCandidate(null);
    setActiveQuery({ id: q.id, message: q.message });
  }

  // Opens the resolution modal for an already-staged candidate - a
  // confirmed one still awaiting notify/don't-notify, or a pending_review
  // one (from "Επανέλεγχος όλων"'s external-search fallback, or a manual
  // search left mid-review) still awaiting Confirm/Reject. GapResolutionModal
  // picks the right starting state from existingCandidate.status itself.
  function openPendingDecision(c: GapSourceCandidateEntry) {
    setActivePendingCandidate(c);
    setActiveQuery({ id: c.chat_session_id, message: c.question });
  }

  const recoveredDecisions = pendingDecisions.filter((c) => c.origin === "recheck_recovery");
  const externalDecisions = pendingDecisions.filter((c) => c.origin !== "recheck_recovery");

  function closeModal() {
    setActiveQuery(null);
    setActivePendingCandidate(null);
  }

  function handleResolved() {
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--space-3)" }}>
        <div>
          <h1>{t("admin.chatGapRate.title")}</h1>
          <p className="text-muted">{t("admin.chatGapRate.description")}</p>
        </div>
        {!isScoped && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginLeft: "auto" }}>
            {recheckRunning && recheckStatus ? (
              <span className="text-muted">
                {t("admin.chatGapRate.recheckAll.progress", {
                  total: recheckTotal,
                  done: Math.max(0, recheckTotal - recheckStatus.pending),
                })}
              </span>
            ) : recheckComplete ? (
              <span className="text-muted">
                {t("admin.chatGapRate.recheckAll.complete", {
                  recovered: recheckComplete.recovered,
                  stillGap: recheckComplete.stillGap,
                })}
              </span>
            ) : null}
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <button type="button" className="btn btn-secondary" disabled={recheckRunning} onClick={runRecheckAll}>
                {recheckRunning ? t("admin.chatGapRate.recheckAll.running") : t("admin.chatGapRate.recheckAll.button")}
              </button>
              <Tooltip text={t("admin.chatGapRate.recheckAll.tooltip")}>
                <InfoIcon size={13} />
              </Tooltip>
            </span>
          </div>
        )}
      </div>

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

      {recoveredDecisions.length > 0 && (
        <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
          <div className={dashStyles.sectionHeader}>
            <h2>{t("admin.chatGapRate.candidates.recoveredTitle")}</h2>
          </div>
          <p className="text-muted" style={{ marginTop: 0, marginBottom: "var(--space-3)", fontSize: "0.85rem" }}>
            {t("admin.chatGapRate.candidates.recoveredHint")}
          </p>
          <div className={styles.candidateList}>
            {recoveredDecisions.map((c) => (
              <div key={c.id} className={styles.candidateCard}>
                <div className={styles.candidateHeader}>
                  <span className="badge status-addressed">{t("admin.chatGapRate.candidates.statusRecovered")}</span>
                  <span className="text-muted" style={{ fontSize: "0.82rem" }}>
                    {t("admin.chatGapRate.candidates.pendingDecisionHint")}
                  </span>
                </div>
                <p className={styles.candidateQuestion}>{c.question}</p>
                <button type="button" className="btn btn-primary" onClick={() => openPendingDecision(c)}>
                  {t("admin.chatGapRate.candidates.decide")}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {externalDecisions.length > 0 && (
        <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
          <div className={dashStyles.sectionHeader}>
            <h2>{t("admin.chatGapRate.candidates.title")}</h2>
          </div>
          <div className={styles.candidateList}>
            {externalDecisions.map((c) => (
              <div key={c.id} className={styles.candidateCard}>
                <div className={styles.candidateHeader}>
                  <span className="badge status-addressed">{t("admin.chatGapRate.candidates.statusConfirmed")}</span>
                  <span className="text-muted" style={{ fontSize: "0.82rem" }}>
                    {t("admin.chatGapRate.candidates.pendingDecisionHint")}
                  </span>
                </div>
                <p className={styles.candidateQuestion}>{c.question}</p>
                <button type="button" className="btn btn-primary" onClick={() => openPendingDecision(c)}>
                  {t("admin.chatGapRate.candidates.decide")}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {needsReview.length > 0 && (
        <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
          <div className={dashStyles.sectionHeader}>
            <h2>{t("admin.chatGapRate.candidates.needsReviewTitle")}</h2>
          </div>
          <p className="text-muted" style={{ marginTop: 0, marginBottom: "var(--space-3)", fontSize: "0.85rem" }}>
            {t("admin.chatGapRate.candidates.needsReviewHint")}
          </p>
          <div className={styles.candidateList}>
            {needsReview.map((c) => (
              <div key={c.id} className={styles.candidateCard}>
                <p className={styles.candidateQuestion}>{c.question}</p>
                <button type="button" className="btn btn-secondary" onClick={() => openPendingDecision(c)}>
                  {t("admin.chatGapRate.candidates.review")}
                </button>
              </div>
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
                      <td>
                        <RowMenu
                          open={openMenuId === q.id}
                          onToggle={() => setOpenMenuId(openMenuId === q.id ? null : q.id)}
                          label={t("admin.chatGapRate.menuActionsFor", { id: q.id })}
                        >
                          {q.addressed ? (
                            <button className={styles.rowMenuItem} onClick={() => updateStatus(q.id, false)}>
                              {t("admin.chatGapRate.markUnreviewed")}
                            </button>
                          ) : (
                            <button className={styles.rowMenuItem} onClick={() => updateStatus(q.id, true)}>
                              {t("admin.chatGapRate.markAddressed")}
                            </button>
                          )}
                          <button className={styles.rowMenuItem} onClick={() => discoverSource(q)}>
                            {t("admin.chatGapRate.discoverSource")}
                          </button>
                        </RowMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      {activeQuery && (
        <GapResolutionModal
          query={activeQuery}
          existingCandidate={activePendingCandidate}
          token={token}
          onClose={closeModal}
          onResolved={handleResolved}
        />
      )}
    </div>
  );
}

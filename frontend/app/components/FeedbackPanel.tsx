"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { StatCard } from "../dashboard/StatCard";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { FeedbackEntry, FeedbackListResponse, UserFeedbackEntry, UserFeedbackListResponse } from "../lib/types";
import { ThumbDownIcon, ThumbUpIcon } from "./StatIcons";
import { BookIcon } from "./UiIcons";
import dashStyles from "../dashboard/dashboard.module.css";
import styles from "./FeedbackPanel.module.css";

type CategoryFilter = "all" | "bug" | "suggestion" | "content_gap";

function UserFeedbackTable({ items, emptyKey }: { items: UserFeedbackEntry[]; emptyKey: TranslationKey }) {
  const { t, tUpper, locale } = useLocale();
  if (items.length === 0) return <p className={dashStyles.emptyState}>{t(emptyKey)}</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{tUpper("adminFeedback.colMessage")}</th>
          <th>{tUpper("adminFeedback.colCompany")}</th>
          <th>{tUpper("adminFeedback.colUser")}</th>
          <th>{tUpper("adminFeedback.colPage")}</th>
          <th>{tUpper("adminFeedback.colDate")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id}>
            <td className={styles.commentCell}>{it.message || "—"}</td>
            <td className="text-muted">{it.company_name ?? "—"}</td>
            <td className="text-muted">{it.user_name}</td>
            <td className="text-muted">{it.page_url ?? "—"}</td>
            <td className="text-muted">{new Date(it.created_at).toLocaleDateString(locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UserFeedbackSection({ token }: { token: string | null }) {
  const { t, tUpper } = useLocale();
  const [items, setItems] = useState<UserFeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api
      .get<UserFeedbackListResponse>("/admin/user-feedback", token)
      .then((data) => setItems(data.items))
      .finally(() => setLoading(false));
  }, [token]);

  const contentGapItems = useMemo(() => items.filter((it) => it.category === "content_gap"), [items]);
  const otherItems = useMemo(
    () =>
      items.filter(
        (it) => it.category !== "content_gap" && (categoryFilter === "all" || it.category === categoryFilter)
      ),
    [items, categoryFilter]
  );

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div className={styles.userFeedbackSection}>
      <h2>{t("adminFeedback.userFeedbackTitle")}</h2>

      {/* Content-gap reports feed directly into the KB gap workflow, so they
          get their own always-visible block instead of being just another
          row behind the category filter below. */}
      <section className={`card ${styles.contentGapCard}`}>
        <h3 style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <BookIcon size={18} />
          {t("adminFeedback.userFeedbackContentGapTitle")}
        </h3>
        <UserFeedbackTable items={contentGapItems} emptyKey="adminFeedback.contentGapEmpty" />
      </section>

      <section className="card" style={{ marginTop: "var(--space-4)", padding: "var(--space-4)" }}>
        <div className={styles.filterBar}>
          <label className={styles.filterField}>
            {tUpper("adminFeedback.filterCategory")}
            <select
              className="input"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            >
              <option value="all">{t("adminFeedback.categoryAll")}</option>
              <option value="bug">{t("adminFeedback.category.bug")}</option>
              <option value="suggestion">{t("adminFeedback.category.suggestion")}</option>
            </select>
          </label>
        </div>
        <UserFeedbackTable items={otherItems} emptyKey="adminFeedback.userFeedbackEmpty" />
      </section>
    </div>
  );
}

type StatusFilter = "all" | "pending" | "solved" | "rejected";
type RatingFilter = "all" | "positive" | "negative";
type VerticalFilter = "all" | "construction" | "tax_accounting";
type PeriodFilter = "7d" | "30d" | "90d" | "all";

const PERIOD_DAYS: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function FeedbackPanel() {
  const { user } = useAuth();
  const { t, tUpper, locale } = useLocale();
  const token = user?.token ?? null;

  const [items, setItems] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [verticalFilter, setVerticalFilter] = useState<VerticalFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("30d");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.get<FeedbackListResponse>("/admin/feedback", token);
      setItems(data.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return items.filter((it) => {
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (ratingFilter !== "all" && it.rating !== ratingFilter) return false;
      if (verticalFilter !== "all" && it.vertical !== verticalFilter) return false;
      if (periodFilter !== "all" && now - new Date(it.created_at).getTime() > PERIOD_DAYS[periodFilter] * DAY_MS) {
        return false;
      }
      return true;
    });
  }, [items, statusFilter, ratingFilter, verticalFilter, periodFilter]);

  // Summary cards read from the full, unfiltered set - they're a fixed
  // triage snapshot, not meant to shift as someone narrows the table below.
  const pendingCount = useMemo(
    () => items.filter((it) => it.rating === "negative" && it.status === "pending").length,
    [items]
  );
  const solved30dCount = useMemo(() => {
    const since = Date.now() - 30 * DAY_MS;
    return items.filter((it) => it.status === "solved" && new Date(it.created_at).getTime() >= since).length;
  }, [items]);
  const positiveCount = useMemo(() => items.filter((it) => it.rating === "positive").length, [items]);
  const negativeCount = useMemo(() => items.filter((it) => it.rating === "negative").length, [items]);

  async function updateStatus(id: number, status: "solved" | "rejected") {
    const updated = await api.patch<FeedbackEntry>(`/admin/feedback/${id}`, { status }, token);
    setItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    setOpenMenuId(null);
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <h1>{t("adminFeedback.title")}</h1>

      <div className={dashStyles.grid} style={{ marginBottom: "var(--space-4)" }}>
        <StatCard tone="danger" icon={<ThumbDownIcon />} value={`${pendingCount}`} label={t("adminFeedback.statPending")} />
        <StatCard tone="primary" icon={<ThumbUpIcon />} value={`${solved30dCount}`} label={t("adminFeedback.statSolved30d")} />
        <StatCard tone="info" icon={<ThumbUpIcon />} value={`${positiveCount} / ${negativeCount}`} label={t("adminFeedback.statRatio")} />
      </div>

      <div className={styles.filterBar}>
        <label className={styles.filterField}>
          {tUpper("adminFeedback.filterStatus")}
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">{t("adminFeedback.filterAll")}</option>
            <option value="pending">{t("adminFeedback.status.pending")}</option>
            <option value="solved">{t("adminFeedback.status.solved")}</option>
            <option value="rejected">{t("adminFeedback.status.rejected")}</option>
          </select>
        </label>
        <label className={styles.filterField}>
          {tUpper("adminFeedback.filterRating")}
          <select className="input" value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value as RatingFilter)}>
            <option value="all">{t("adminFeedback.filterAll")}</option>
            <option value="positive">{t("chat.feedbackPositive")}</option>
            <option value="negative">{t("chat.feedbackNegative")}</option>
          </select>
        </label>
        <label className={styles.filterField}>
          {tUpper("adminFeedback.filterVertical")}
          <select className="input" value={verticalFilter} onChange={(e) => setVerticalFilter(e.target.value as VerticalFilter)}>
            <option value="all">{t("adminFeedback.filterAll")}</option>
            <option value="construction">{t("vertical.construction")}</option>
            <option value="tax_accounting">{t("vertical.tax_accounting")}</option>
          </select>
        </label>
        <label className={styles.filterField}>
          {tUpper("adminFeedback.filterPeriod")}
          <select className="input" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}>
            <option value="7d">{t("adminFeedback.period.7d")}</option>
            <option value="30d">{t("adminFeedback.period.30d")}</option>
            <option value="90d">{t("adminFeedback.period.90d")}</option>
            <option value="all">{t("adminFeedback.period.all")}</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className={dashStyles.emptyState}>{t("adminFeedback.empty")}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{tUpper("adminFeedback.colQuestion")}</th>
              <th>{tUpper("adminFeedback.colComment")}</th>
              <th>{tUpper("adminFeedback.colRating")}</th>
              <th>{tUpper("adminFeedback.colCompany")}</th>
              <th>{tUpper("adminFeedback.colUser")}</th>
              <th>{tUpper("adminFeedback.colDate")}</th>
              <th>{tUpper("adminFeedback.colStatus")}</th>
              <th>{tUpper("adminFeedback.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => (
              <Fragment key={it.id}>
                <tr>
                  <td className={styles.questionCell}>{it.question}</td>
                  <td className={styles.commentCell}>{it.feedback_text || "—"}</td>
                  <td>
                    {it.rating === "positive" ? (
                      <span className={styles.ratingPositive}>
                        <ThumbUpIcon size={16} />
                      </span>
                    ) : (
                      <span className={styles.ratingNegative}>
                        <ThumbDownIcon size={16} />
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{it.company_name ?? "—"}</td>
                  <td className="text-muted">{it.user_name}</td>
                  <td className="text-muted">{new Date(it.created_at).toLocaleDateString(locale)}</td>
                  <td>
                    <span className={`badge ${styles[`status-${it.status}`]}`}>
                      {t(`adminFeedback.status.${it.status}` as TranslationKey)}
                    </span>
                  </td>
                  <td className={styles.rowMenuWrap}>
                    <button
                      type="button"
                      className={styles.rowMenuButton}
                      aria-label={t("adminFeedback.menuActionsFor", { id: it.id })}
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === it.id}
                      onClick={() => setOpenMenuId(openMenuId === it.id ? null : it.id)}
                    >
                      ⋯
                    </button>
                    {openMenuId === it.id && (
                      <div className={styles.rowMenu} role="menu">
                        <button
                          className={styles.rowMenuItem}
                          onClick={() => {
                            setDetailId(detailId === it.id ? null : it.id);
                            setOpenMenuId(null);
                          }}
                        >
                          {t("adminFeedback.menuFullView")}
                        </button>
                        {it.status !== "solved" && (
                          <button className={styles.rowMenuItem} onClick={() => updateStatus(it.id, "solved")}>
                            {t("adminFeedback.menuMarkSolved")}
                          </button>
                        )}
                        {it.status !== "rejected" && (
                          <button className={styles.rowMenuItem} onClick={() => updateStatus(it.id, "rejected")}>
                            {t("adminFeedback.menuReject")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
                {detailId === it.id && (
                  <tr>
                    <td colSpan={8} className={styles.detailRow}>
                      <div className={styles.detailField}>
                        <span className={styles.detailLabel}>{tUpper("adminFeedback.detailQuestion")}</span>
                        <p>{it.question}</p>
                      </div>
                      <div className={styles.detailField}>
                        <span className={styles.detailLabel}>{tUpper("adminFeedback.detailAnswer")}</span>
                        <p>{it.answer_excerpt}</p>
                      </div>
                      {it.feedback_text && (
                        <div className={styles.detailField}>
                          <span className={styles.detailLabel}>{tUpper("adminFeedback.detailFeedback")}</span>
                          <p>{it.feedback_text}</p>
                        </div>
                      )}
                      <div className={styles.detailField}>
                        <span className={styles.detailLabel}>{tUpper("adminFeedback.detailContext")}</span>
                        <p className="text-muted">
                          {it.company_name ?? "—"} · {it.user_name} ·{" "}
                          {it.vertical ? t(`vertical.${it.vertical}` as TranslationKey) : "—"}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      <UserFeedbackSection token={token} />
    </div>
  );
}

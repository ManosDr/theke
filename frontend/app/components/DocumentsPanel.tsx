"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { useVertical } from "../lib/vertical";
import type {
  BrowseResponse,
  DocumentSummary,
  DocumentValidationResult,
  RevalidateAllResponse,
  RevalidationStatusResponse,
  VerticalSummary,
} from "../lib/types";
import { ClockIcon, InfoIcon } from "./StatIcons";
import { CheckIcon, CloseIcon, DotIcon, EyeIcon, LinkIcon, PencilIcon, WarningIcon } from "./UiIcons";
import Tooltip from "./Tooltip";
import styles from "./DocumentsPanel.module.css";
import dashStyles from "../dashboard/dashboard.module.css";

const ACCENT_CLASS: Record<string, string> = {
  construction: styles.accentConstruction,
  tax_accounting: styles.accentTax,
};

// Flattens two orthogonal backend fields (Document.status,
// Document.needs_review) plus extraction_status into the single status
// vocabulary the design specifies - the backend never stores "needs_review"
// as a status value (it's a separate boolean any active document can carry),
// so this is a display-only precedence, not a real enum.
function effectiveStatus(doc: DocumentSummary): string {
  if (doc.status === "superseded") return "superseded";
  if (doc.status === "removed") return "removed";
  if (doc.needs_review) return "needs_review";
  if (doc.extraction_status === "manual_entry") return "manual_entry";
  if (doc.extraction_status === "reference_only") return "reference_only";
  if (doc.extraction_status === "manual_entry_pending") return "manual_entry_pending";
  return "active";
}

const STATUS_COLOR: Record<string, string> = {
  active: "var(--admin-success)",
  superseded: "var(--admin-stone)",
  needs_review: "var(--admin-warning)",
  manual_entry: "var(--admin-navy)",
  reference_only: "var(--admin-stone)",
  manual_entry_pending: "var(--admin-warning)",
  removed: "var(--admin-danger)",
};

const STATUS_ICON: Record<string, typeof DotIcon> = {
  active: DotIcon,
  superseded: LinkIcon,
  needs_review: DotIcon,
  manual_entry: PencilIcon,
  reference_only: EyeIcon,
  manual_entry_pending: ClockIcon,
  removed: CloseIcon,
};

const PAGE_SIZE = 25;

export function DocumentsPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const token = user?.token ?? null;
  const { selectedVertical } = useVertical();

  const [verticals, setVerticals] = useState<VerticalSummary[]>([]);
  const [verticalFilter, setVerticalFilter] = useState<number | "">("");
  const [status, setStatus] = useState("");
  const [authority, setAuthority] = useState("");
  const [contentType, setContentType] = useState("");
  const [supersededOnly, setSupersededOnly] = useState(false);
  const [autoFlaggedOnly, setAutoFlaggedOnly] = useState(false);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [offset, setOffset] = useState(0);

  const [result, setResult] = useState<BrowseResponse>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [drawerDoc, setDrawerDoc] = useState<DocumentSummary | null>(null);
  const [supersedeTarget, setSupersedeTarget] = useState<DocumentSummary | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DocumentSummary | null>(null);
  const [undoConfirmId, setUndoConfirmId] = useState<number | null>(null);
  const [undoChecked, setUndoChecked] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // AI revalidation - one row's panel open at a time, keyed by document id.
  const [revalidatingId, setRevalidatingId] = useState<number | null>(null);
  const [revalidationLoading, setRevalidationLoading] = useState(false);
  const [revalidationResult, setRevalidationResult] = useState<DocumentValidationResult | null>(null);
  const [editedSuggestion, setEditedSuggestion] = useState("");
  const [currentContentFull, setCurrentContentFull] = useState("");
  const [revalidationActionLoading, setRevalidationActionLoading] = useState(false);

  // needs_review banner + bulk AI validation
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkStatus, setBulkStatus] = useState<RevalidationStatusResponse | null>(null);
  const [bulkComplete, setBulkComplete] = useState<{ changed: number; accurate: number } | null>(null);

  async function refreshNeedsReviewCount() {
    if (!token) return;
    try {
      const data = await api.get<BrowseResponse>("/admin/documents?needs_review_only=true&limit=1", token);
      setNeedsReviewCount(data.total);
    } catch {
      // best-effort - banner just stays at its last known count
    }
  }

  useEffect(() => {
    if (!token) return;
    api.get<VerticalSummary[]>("/admin/verticals", token).then(setVerticals).catch(() => setVerticals([]));
  }, [token]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(handle);
  }, [q]);

  const activeVerticalId = useMemo(() => {
    if (selectedVertical !== "all") return verticals.find((v) => v.slug === selectedVertical)?.id ?? null;
    return verticalFilter === "" ? null : verticalFilter;
  }, [selectedVertical, verticalFilter, verticals]);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (activeVerticalId) params.set("vertical_id", String(activeVerticalId));
      if (supersededOnly) params.set("superseded_only", "true");
      else if (status) params.set("status_filter", status);
      if (authority) params.set("authority", authority);
      if (contentType) params.set("content_type", contentType);
      if (autoFlaggedOnly) params.set("auto_flagged_only", "true");
      if (needsReviewOnly) params.set("needs_review_only", "true");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      const data = await api.get<BrowseResponse>(`/admin/documents?${params.toString()}`, token);
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    refreshNeedsReviewCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    debouncedQ,
    activeVerticalId,
    status,
    authority,
    contentType,
    supersededOnly,
    autoFlaggedOnly,
    needsReviewOnly,
    offset,
  ]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQ, activeVerticalId, status, authority, contentType, supersededOnly, autoFlaggedOnly, needsReviewOnly]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (removeTarget) setRemoveTarget(null);
      else if (supersedeTarget) setSupersedeTarget(null);
      else if (drawerDoc) setDrawerDoc(null);
      else if (openMenuId !== null) setOpenMenuId(null);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [removeTarget, supersedeTarget, drawerDoc, openMenuId]);

  const hasFilters = Boolean(
    debouncedQ ||
      status ||
      authority ||
      contentType ||
      supersededOnly ||
      autoFlaggedOnly ||
      needsReviewOnly ||
      verticalFilter
  );

  function clearFilters() {
    setQ("");
    setStatus("");
    setAuthority("");
    setContentType("");
    setSupersededOnly(false);
    setAutoFlaggedOnly(false);
    setNeedsReviewOnly(false);
    setVerticalFilter("");
  }

  async function openDocumentById(id: number) {
    if (!token) return;
    const doc = await api.get<DocumentSummary>(`/admin/documents/${id}`, token);
    setDrawerDoc(doc);
  }

  async function markReviewed(doc: DocumentSummary) {
    if (!token) return;
    await api.post(`/admin/stale-documents/${doc.id}/mark-reviewed`, { confirmed: true }, token);
    setOpenMenuId(null);
    refresh();
    refreshNeedsReviewCount();
  }

  async function startRevalidation(doc: DocumentSummary) {
    if (!token) return;
    setOpenMenuId(null);
    setRevalidatingId(doc.id);
    setRevalidationResult(null);
    setCurrentContentFull("");
    setRevalidationLoading(true);
    try {
      const data = await api.post<DocumentValidationResult>(`/admin/documents/${doc.id}/revalidate`, undefined, token);
      setRevalidationResult(data);
      setEditedSuggestion(data.suggested_content ?? "");
      if (data.status === "validated" && data.still_accurate === false) {
        const full = await api.get<DocumentSummary>(`/admin/documents/${doc.id}`, token);
        setCurrentContentFull(full.full_content ?? "");
      }
    } finally {
      setRevalidationLoading(false);
    }
  }

  function closeRevalidationPanel() {
    setRevalidatingId(null);
    setRevalidationResult(null);
    setEditedSuggestion("");
  }

  async function markReviewedFromPanel(docId: number) {
    if (!token || !revalidationResult) return;
    setRevalidationActionLoading(true);
    try {
      await api.post(
        `/admin/stale-documents/${docId}/mark-reviewed`,
        { confirmed: true, validation_id: revalidationResult.validation_id },
        token
      );
      closeRevalidationPanel();
      refresh();
      refreshNeedsReviewCount();
    } finally {
      setRevalidationActionLoading(false);
    }
  }

  async function applySuggestion(docId: number, content: string, action: "accepted" | "edited") {
    if (!token || !revalidationResult?.validation_id) return;
    setRevalidationActionLoading(true);
    try {
      await api.post(
        `/admin/documents/${docId}/apply-suggestion`,
        { content, validation_id: revalidationResult.validation_id, action },
        token
      );
      closeRevalidationPanel();
      refresh();
      refreshNeedsReviewCount();
    } finally {
      setRevalidationActionLoading(false);
    }
  }

  async function runBulkRevalidation() {
    if (!token) return;
    const data = await api.post<RevalidateAllResponse>("/admin/documents/revalidate-all", undefined, token);
    setBulkTotal(data.queued);
    setBulkComplete(null);
    if (data.queued > 0) setBulkRunning(true);
  }

  useEffect(() => {
    if (!bulkRunning || !token) return;
    const interval = setInterval(async () => {
      const data = await api.get<RevalidationStatusResponse>("/admin/documents/revalidation-status", token);
      setBulkStatus(data);
      if (data.pending === 0) {
        setBulkRunning(false);
        setBulkComplete({ changed: data.changed, accurate: data.accurate });
        refresh();
        refreshNeedsReviewCount();
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkRunning, token]);

  async function undoSupersede(doc: DocumentSummary) {
    if (!token) return;
    await api.post(`/admin/documents/${doc.id}/undo-supersede`, { confirmed: true }, token);
    setOpenMenuId(null);
    setUndoConfirmId(null);
    setUndoChecked(false);
    refresh();
  }

  return (
    <div>
      <div className={styles.headerRow}>
        <h1>{t("docs.title")}</h1>
        <span className={styles.countPill}>{t("docs.countPill", { count: result.total })}</span>
        <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setShowCreateModal(true)}>
          {t("docs.newDocument")}
        </button>
      </div>

      {needsReviewCount > 0 && (
        <div className={`card ${styles.needsReviewBanner}`}>
          <span>{t("docs.revalidate.needsReviewBanner", { count: needsReviewCount })}</span>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", marginLeft: "auto" }}>
            {bulkRunning && bulkStatus ? (
              <span className="text-muted">
                {t("docs.revalidate.bulkProgress", {
                  total: bulkTotal,
                  done: Math.max(0, bulkTotal - bulkStatus.pending),
                })}
              </span>
            ) : bulkComplete ? (
              <span className="text-muted">
                {t("docs.revalidate.bulkComplete", { changed: bulkComplete.changed, clean: bulkComplete.accurate })}
              </span>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={() => setNeedsReviewOnly(true)}>
              {t("docs.revalidate.viewNow")}
            </button>
            <button type="button" className="btn btn-primary" disabled={bulkRunning} onClick={runBulkRevalidation}>
              {t("docs.revalidate.validateAllAi")}
            </button>
          </div>
        </div>
      )}

      <div className={`card ${styles.filterBar}`}>
        {selectedVertical === "all" && (
          <select className="input" value={verticalFilter} onChange={(e) => setVerticalFilter(e.target.value ? Number(e.target.value) : "")}>
            <option value="">{t("docs.filterVertical")}</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.display_name}
              </option>
            ))}
          </select>
        )}

        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} disabled={supersededOnly}>
          <option value="">{t("docs.filterStatus")}</option>
          <option value="active">{t("docs.status.active")}</option>
          <option value="superseded">{t("docs.status.superseded")}</option>
        </select>

        <select className="input" value={authority} onChange={(e) => setAuthority(e.target.value)}>
          <option value="">{t("docs.filterAuthority")}</option>
          {["tee", "ydom", "dasarcheio", "deddie", "deya", "ktimatologio", "aade", "efka", "mida", "ypen", "other"].map((a) => (
            <option key={a} value={a}>
              {a.toUpperCase()}
            </option>
          ))}
        </select>

        <select className="input" value={contentType} onChange={(e) => setContentType(e.target.value)}>
          <option value="">{t("docs.filterContentType")}</option>
          {["procedural_howto", "legal_reference", "regulatory_change_notice", "form", "faq"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className={styles.filterCheckbox}>
          <input
            type="checkbox"
            checked={supersededOnly}
            onChange={(e) => setSupersededOnly(e.target.checked)}
          />
          {t("docs.supersededOnly")}
        </label>

        <label className={styles.filterCheckbox}>
          <input
            type="checkbox"
            checked={autoFlaggedOnly}
            onChange={(e) => setAutoFlaggedOnly(e.target.checked)}
          />
          {t("docs.autoFlaggedOnly")}
        </label>

        <label className={styles.filterCheckbox}>
          <input
            type="checkbox"
            checked={needsReviewOnly}
            onChange={(e) => setNeedsReviewOnly(e.target.checked)}
          />
          {t("docs.status.needs_review")}
        </label>

        <input
          className={`input ${styles.searchInput}`}
          type="text"
          placeholder={t("docs.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {hasFilters && (
          <button type="button" className={styles.clearFilters} onClick={clearFilters}>
            {t("docs.clearFilters")}
          </button>
        )}
      </div>

      <section className={`card ${dashStyles.section}`}>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : result.items.length === 0 ? (
          <p className={dashStyles.emptyState}>{hasFilters ? t("docs.emptyFiltered") : t("docs.empty")}</p>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{tUpper("docs.colTitle")}</th>
                  <th>{tUpper("docs.colVertical")}</th>
                  <th>{tUpper("docs.colAuthority")}</th>
                  <th>{tUpper("docs.colContentType")}</th>
                  <th>
                    {tUpper("docs.colStatus")}
                    <Tooltip text={t("docs.colStatusTooltip")}>
                      <InfoIcon size={12} />
                    </Tooltip>
                  </th>
                  <th>{tUpper("docs.colLastVerified")}</th>
                  <th>{tUpper("docs.colScope")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((doc) => {
                  const eff = effectiveStatus(doc);
                  const accent = ACCENT_CLASS[doc.vertical_slug ?? ""] ?? "";
                  return (
                    <Fragment key={doc.id}>
                    <tr className={eff === "superseded" ? styles.rowSuperseded : ""}>
                      <td>
                        <button type="button" className={styles.titleText} style={{ background: "none", border: "none", textAlign: "left", padding: 0, cursor: "pointer" }} onClick={() => setDrawerDoc(doc)}>
                          {doc.title ?? "—"}
                        </button>
                        {doc.replaced_by && (
                          <span className={styles.replacementCaption} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <LinkIcon size={11} />
                            {t("docs.replacedBy", { title: doc.replaced_by.title ?? `#${doc.replaced_by.id}` })}
                          </span>
                        )}
                        {doc.replaces && (
                          <span className={styles.replacementCaption}>
                            {t("docs.replaces", { title: doc.replaces.title ?? `#${doc.replaces.id}` })}
                          </span>
                        )}
                        {doc.auto_needs_review_reason && (
                          <span className={styles.replacementCaption} style={{ color: "var(--admin-warning)" }}>
                            {t("docs.autoFlaggedLabel")} {doc.auto_needs_review_reason}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`${styles.verticalBadge} ${accent}`}>
                          {doc.vertical_slug ? t(`vertical.${doc.vertical_slug}` as TranslationKey) : "—"}
                        </span>
                      </td>
                      <td className="text-muted">{doc.authority ?? "—"}</td>
                      <td className="text-muted">{doc.content_type ?? "—"}</td>
                      <td>
                        <span className={styles.statusBadge} style={{ color: STATUS_COLOR[eff] }}>
                          {(() => {
                            const StatusIcon = STATUS_ICON[eff];
                            return <StatusIcon size={13} />;
                          })()}
                          {t(`docs.status.${eff}` as TranslationKey)}
                        </span>
                      </td>
                      <td className="text-muted">
                        {doc.last_verified_at ? new Date(doc.last_verified_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="text-muted">
                        {doc.region_id ? t("docs.scopeRegion", { region: doc.region_id }) : t("docs.scopeNational")}
                      </td>
                      <td className={styles.rowMenuWrap}>
                        <button
                          type="button"
                          className={styles.rowMenuButton}
                          aria-label={t("docs.menuActionsFor", { title: doc.title ?? `#${doc.id}` })}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === doc.id}
                          onClick={() => {
                            setOpenMenuId(openMenuId === doc.id ? null : doc.id);
                            setUndoConfirmId(null);
                            setUndoChecked(false);
                          }}
                        >
                          ⋯
                        </button>
                        {openMenuId === doc.id && (
                          <div className={styles.rowMenu} role="menu">
                            <button className={styles.rowMenuItem} onClick={() => { setDrawerDoc(doc); setOpenMenuId(null); }}>
                              {t("docs.menuView")}
                            </button>
                            {doc.needs_review && (
                              <button className={styles.rowMenuItem} onClick={() => startRevalidation(doc)}>
                                {t("docs.menuRevalidateAi")}
                              </button>
                            )}
                            {doc.needs_review && (
                              <button className={styles.rowMenuItem} onClick={() => markReviewed(doc)}>
                                {t("docs.menuMarkReviewed")}
                              </button>
                            )}
                            {doc.status === "active" && (
                              <button className={styles.rowMenuItem} onClick={() => { setSupersedeTarget(doc); setOpenMenuId(null); }}>
                                {t("docs.menuMarkSuperseded")}
                              </button>
                            )}
                            {eff === "superseded" && (
                              undoConfirmId === doc.id ? (
                                <div className={styles.rowMenuConfirm}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={undoChecked}
                                      onChange={(e) => setUndoChecked(e.target.checked)}
                                    />
                                    {t("docs.confirmUndo")}
                                  </label>
                                  <button
                                    className={styles.rowMenuItem}
                                    disabled={!undoChecked}
                                    onClick={() => undoSupersede(doc)}
                                  >
                                    {t("docs.menuUndoSupersede")}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className={styles.rowMenuItem}
                                  onClick={() => { setUndoConfirmId(doc.id); setUndoChecked(false); }}
                                >
                                  {t("docs.menuUndoSupersede")}
                                </button>
                              )
                            )}
                            <button
                              className={`${styles.rowMenuItem} ${styles.rowMenuItemDanger}`}
                              onClick={() => { setRemoveTarget(doc); setOpenMenuId(null); }}
                            >
                              {t("docs.menuRemove")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {revalidatingId === doc.id && (
                      <tr>
                        <td colSpan={8} className={styles.revalidatePanel}>
                          {revalidationLoading ? (
                            <p className="text-muted">{t("docs.revalidate.loading")}</p>
                          ) : revalidationResult?.status === "source_unavailable" ? (
                            <div>
                              <p>
                                <strong style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--admin-danger)" }}>
                                  <CloseIcon size={14} />
                                  {t("docs.revalidate.unavailableTitle")}
                                </strong>
                              </p>
                              <p className="text-muted">{revalidationResult.reason}</p>
                              <div className={styles.modalActions} style={{ justifyContent: "flex-start" }}>
                                <button
                                  className="btn btn-secondary"
                                  disabled={revalidationActionLoading}
                                  onClick={() => markReviewedFromPanel(doc.id)}
                                >
                                  {t("docs.revalidate.markReviewedManually")}
                                </button>
                                <button className="btn btn-secondary" onClick={closeRevalidationPanel}>
                                  {t("docs.revalidate.close")}
                                </button>
                              </div>
                            </div>
                          ) : revalidationResult?.still_accurate === true ? (
                            <div>
                              <p>
                                <strong style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--admin-success)" }}>
                                  <CheckIcon size={14} />
                                  {t("docs.revalidate.accurateTitle")}
                                </strong>{" "}
                                <span className="badge">{revalidationResult.confidence}</span>
                              </p>
                              <p className="text-muted" style={{ fontStyle: "italic" }}>
                                "{revalidationResult.reasoning}"
                              </p>
                              <div className={styles.modalActions} style={{ justifyContent: "flex-start" }}>
                                <button
                                  className="btn btn-secondary"
                                  disabled={revalidationActionLoading}
                                  onClick={() => markReviewedFromPanel(doc.id)}
                                >
                                  {t("docs.revalidate.markReviewed")}
                                </button>
                                <button className="btn btn-secondary" onClick={closeRevalidationPanel}>
                                  {t("docs.revalidate.close")}
                                </button>
                              </div>
                            </div>
                          ) : revalidationResult?.still_accurate === false ? (
                            <div>
                              <p>
                                <strong style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--admin-warning)" }}>
                                  <WarningIcon size={14} />
                                  {t("docs.revalidate.changesTitle")}
                                </strong>{" "}
                                <span className="badge">{revalidationResult.confidence}</span>
                              </p>
                              <p>
                                <strong>{t("docs.revalidate.whatChanged")}</strong> {revalidationResult.changes_detected}
                              </p>

                              <label style={{ display: "block", margin: "8px 0 4px", fontSize: "0.85rem", fontWeight: 600 }}>
                                {t("docs.revalidate.currentContent")}
                              </label>
                              <textarea
                                className="input"
                                value={currentContentFull}
                                readOnly
                                rows={6}
                                style={{ width: "100%", fontFamily: "inherit", background: "var(--admin-parchment)" }}
                              />

                              <label style={{ display: "block", margin: "8px 0 4px", fontSize: "0.85rem", fontWeight: 600 }}>
                                {t("docs.revalidate.suggestedContent")}
                              </label>
                              <textarea
                                className="input"
                                value={editedSuggestion}
                                onChange={(e) => setEditedSuggestion(e.target.value)}
                                rows={6}
                                style={{ width: "100%", fontFamily: "inherit" }}
                              />

                              <div className={styles.modalActions} style={{ justifyContent: "flex-start" }}>
                                <button
                                  className="btn btn-primary"
                                  disabled={revalidationActionLoading}
                                  onClick={() => applySuggestion(doc.id, revalidationResult!.suggested_content ?? "", "accepted")}
                                >
                                  {t("docs.revalidate.accept")}
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  disabled={revalidationActionLoading}
                                  onClick={() => applySuggestion(doc.id, editedSuggestion, "edited")}
                                >
                                  {t("docs.revalidate.saveEdited")}
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  disabled={revalidationActionLoading}
                                  onClick={() => markReviewedFromPanel(doc.id)}
                                >
                                  {t("docs.revalidate.dismiss")}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            <div className={styles.pagination}>
              <span className="text-muted">
                {t("common.paginationRange", {
                  from: offset + 1,
                  to: Math.min(offset + PAGE_SIZE, result.total),
                  total: result.total,
                })}
              </span>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button className="btn btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  {t("common.previous")}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={offset + PAGE_SIZE >= result.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  {t("common.next")}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {drawerDoc && (
        <>
          <div className={styles.scrim} onClick={() => setDrawerDoc(null)} />
          <div className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="doc-drawer-title">
            <div className={styles.drawerHeader}>
              <div>
                <h2 id="doc-drawer-title">{drawerDoc.title}</h2>
                <div className={styles.drawerBadges}>
                  <span className={`${styles.verticalBadge} ${ACCENT_CLASS[drawerDoc.vertical_slug ?? ""] ?? ""}`}>
                    {drawerDoc.vertical_slug ? t(`vertical.${drawerDoc.vertical_slug}` as TranslationKey) : "—"}
                  </span>
                  <span className={styles.statusBadge} style={{ color: STATUS_COLOR[effectiveStatus(drawerDoc)] }}>
                    {(() => {
                      const StatusIcon = STATUS_ICON[effectiveStatus(drawerDoc)];
                      return <StatusIcon size={13} />;
                    })()}
                    {t(`docs.status.${effectiveStatus(drawerDoc)}` as TranslationKey)}
                  </span>
                </div>
              </div>
              <button className="btn btn-secondary" onClick={() => setDrawerDoc(null)}>
                {t("docs.drawer.close")}
              </button>
            </div>

            {(drawerDoc.replaced_by || drawerDoc.replaces) && (
              <p>
                {drawerDoc.replaced_by && (
                  <span className={styles.metaLabel}>
                    {tUpper("docs.drawer.replacedByLabel")}:{" "}
                    <button
                      type="button"
                      className={styles.titleText}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => openDocumentById(drawerDoc.replaced_by!.id)}
                    >
                      {drawerDoc.replaced_by.title ?? `#${drawerDoc.replaced_by.id}`}
                    </button>
                  </span>
                )}
                {drawerDoc.replaces && (
                  <span className={styles.metaLabel}>
                    {tUpper("docs.drawer.replacesLabel")}:{" "}
                    <button
                      type="button"
                      className={styles.titleText}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => openDocumentById(drawerDoc.replaces!.id)}
                    >
                      {drawerDoc.replaces.title ?? `#${drawerDoc.replaces.id}`}
                    </button>
                  </span>
                )}
              </p>
            )}

            <div className={styles.metadataGrid}>
              <div className={styles.metadataItem}>
                <span className={styles.metaLabel}>{tUpper("docs.drawer.authority")}</span>
                <span className="metaValue">{drawerDoc.authority ?? "—"}</span>
              </div>
              <div className={styles.metadataItem}>
                <span className={styles.metaLabel}>{tUpper("docs.drawer.contentType")}</span>
                <span className="metaValue">{drawerDoc.content_type ?? "—"}</span>
              </div>
              <div className={styles.metadataItem}>
                <span className={styles.metaLabel}>{tUpper("docs.drawer.scope")}</span>
                <span className="metaValue">
                  {drawerDoc.region_id ? t("docs.scopeRegion", { region: drawerDoc.region_id }) : t("docs.scopeNational")}
                </span>
              </div>
              <div className={styles.metadataItem}>
                <span className={styles.metaLabel}>{tUpper("docs.drawer.lastVerified")}</span>
                <span className="metaValue">
                  {drawerDoc.last_verified_at ? new Date(drawerDoc.last_verified_at).toLocaleDateString() : "—"}
                </span>
              </div>
              <div className={styles.metadataItem}>
                <span className={styles.metaLabel}>{tUpper("docs.drawer.extractionStatus")}</span>
                <span className="metaValue">
                  {drawerDoc.extraction_status ? t(`docs.status.${drawerDoc.extraction_status}` as TranslationKey) : "—"}
                </span>
              </div>
              <div className={styles.metadataItem}>
                <span className={styles.metaLabel}>{tUpper("docs.drawer.createdAt")}</span>
                <span className="metaValue">{drawerDoc.date ? new Date(drawerDoc.date).toLocaleDateString() : "—"}</span>
              </div>
            </div>

            {drawerDoc.source && (
              <p>
                <span className={styles.metaLabel}>{tUpper("docs.drawer.sourceUrl")}</span>
                <a href={drawerDoc.source} target="_blank" rel="noreferrer" style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                  {drawerDoc.source}
                </a>
              </p>
            )}

            {drawerDoc.snippet && (
              <>
                <span className={styles.metaLabel}>{tUpper("docs.drawer.contentPreview")}</span>
                <div className={styles.contentPreview}>{drawerDoc.snippet}</div>
              </>
            )}
          </div>
        </>
      )}

      {supersedeTarget && (
        <SupersedeModal
          target={supersedeTarget}
          token={token}
          onClose={() => setSupersedeTarget(null)}
          onDone={() => {
            setSupersedeTarget(null);
            refresh();
          }}
        />
      )}

      {removeTarget && (
        <RemoveModal
          target={removeTarget}
          token={token}
          onClose={() => setRemoveTarget(null)}
          onDone={() => {
            setRemoveTarget(null);
            refresh();
          }}
        />
      )}

      {showCreateModal && (
        <CreateDocumentModal
          token={token}
          verticals={verticals}
          onClose={() => setShowCreateModal(false)}
          onDone={() => {
            setShowCreateModal(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateDocumentModal({
  token,
  verticals,
  onClose,
  onDone,
}: {
  token: string | null;
  verticals: VerticalSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [verticalId, setVerticalId] = useState<number | "">(verticals[0]?.id ?? "");
  const [source, setSource] = useState("");
  const [authority, setAuthority] = useState("");
  const [contentType, setContentType] = useState("");
  const [regionId, setRegionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // extraction_status is always "manual_entry" for this form - the only
  // creation path a super admin has - so source is always required here,
  // matching the backend's going-forward KB staleness policy (see
  // KNOWN_DECISIONS.md): a manual_entry document with no source is a
  // document nobody can ever revalidate against a real source later.
  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && verticalId !== "" && source.trim().length > 0;

  async function submit() {
    if (!token || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        "/admin/documents",
        {
          title: title.trim(),
          content: content.trim(),
          vertical_id: verticalId,
          source: source.trim(),
          authority: authority || null,
          content_type: contentType || null,
          region_id: regionId.trim() || null,
          extraction_status: "manual_entry",
        },
        token
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="create-doc-modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="create-doc-modal-title">{t("docs.create.title")}</h2>

        <label style={{ display: "block", marginBottom: 4, fontSize: "0.85rem", fontWeight: 600 }}>
          {t("docs.create.titleLabel")}
        </label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />

        <label style={{ display: "block", margin: "12px 0 4px", fontSize: "0.85rem", fontWeight: 600 }}>
          {t("docs.create.verticalLabel")}
        </label>
        <select
          className="input"
          value={verticalId}
          onChange={(e) => setVerticalId(e.target.value ? Number(e.target.value) : "")}
          style={{ width: "100%" }}
        >
          {verticals.map((v) => (
            <option key={v.id} value={v.id}>
              {v.display_name}
            </option>
          ))}
        </select>

        <label style={{ display: "block", margin: "12px 0 4px", fontSize: "0.85rem", fontWeight: 600 }}>
          {t("docs.create.contentLabel")}
        </label>
        <textarea
          className="input"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          style={{ width: "100%", fontFamily: "inherit" }}
        />

        <label style={{ display: "block", margin: "12px 0 4px", fontSize: "0.85rem", fontWeight: 600 }}>
          {t("docs.create.sourceLabel")} *
        </label>
        <input className="input" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: "100%" }} />
        <p className={styles.modalHelper}>{t("docs.create.sourceHelper")} {t("docs.create.sourceRequired")}</p>

        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: "0.85rem", fontWeight: 600 }}>
              {t("docs.create.authorityLabel")}
            </label>
            <select className="input" value={authority} onChange={(e) => setAuthority(e.target.value)} style={{ width: "100%" }}>
              <option value="">{t("docs.filterAll")}</option>
              {["tee", "ydom", "dasarcheio", "deddie", "deya", "ktimatologio", "aade", "efka", "mida", "ypen", "other"].map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: "0.85rem", fontWeight: 600 }}>
              {t("docs.create.contentTypeLabel")}
            </label>
            <select className="input" value={contentType} onChange={(e) => setContentType(e.target.value)} style={{ width: "100%" }}>
              <option value="">{t("docs.filterAll")}</option>
              {["procedural_howto", "legal_reference", "regulatory_change_notice", "form", "faq"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label style={{ display: "block", margin: "12px 0 4px", fontSize: "0.85rem", fontWeight: 600 }}>
          {t("docs.create.regionLabel")}
        </label>
        <input className="input" value={regionId} onChange={(e) => setRegionId(e.target.value)} style={{ width: "100%" }} />

        {error && (
          <p className={styles.modalHelper} style={{ color: "var(--admin-danger)" }}>
            {error}
          </p>
        )}

        <div className={styles.modalActions}>
          <button className="btn btn-secondary" onClick={onClose}>
            {t("docs.create.cancel")}
          </button>
          <button className="btn btn-primary" disabled={!canSubmit || submitting} onClick={submit}>
            {submitting ? t("docs.create.submitting") : t("docs.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SupersedeModal({
  target,
  token,
  onClose,
  onDone,
}: {
  target: DocumentSummary;
  token: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<DocumentSummary[]>([]);
  const [selected, setSelected] = useState<DocumentSummary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("vertical_id", String(target.vertical_id ?? ""));
    params.set("status_filter", "active");
    params.set("limit", "20");
    api
      .get<BrowseResponse>(`/admin/documents?${params.toString()}`, token)
      .then((data) => setCandidates(data.items.filter((d) => d.id !== target.id)));
  }, [query, token, target.id, target.vertical_id]);

  async function confirm() {
    if (!token || !selected || !confirmed) return;
    setSubmitting(true);
    try {
      await api.post(`/admin/documents/${target.id}/mark-superseded`, { replaced_by_document_id: selected.id, confirmed: true }, token);
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="supersede-modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="supersede-modal-title">{t("docs.supersede.title")}</h2>
        <div className={styles.targetCard}>
          <strong>{target.title}</strong>
          <div className="text-muted">{target.authority ?? "—"}</div>
        </div>

        <label style={{ display: "block", marginBottom: 4, fontSize: "0.85rem", fontWeight: 600 }}>
          {t("docs.supersede.searchLabel")}
        </label>
        <input
          className="input"
          placeholder={t("docs.supersede.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.candidateList}>
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.candidateRow} ${selected?.id === c.id ? styles.candidateRowSelected : ""}`}
              onClick={() => setSelected(c)}
            >
              {c.title}
            </button>
          ))}
        </div>

        <label className={styles.modalCheckboxRow}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          {t("docs.supersede.confirmCheckbox")}
        </label>

        <div className={styles.modalActions}>
          <button className="btn btn-secondary" onClick={onClose}>
            {t("docs.supersede.cancel")}
          </button>
          <button className="btn btn-primary" disabled={!selected || !confirmed || submitting} onClick={confirm}>
            {t("docs.supersede.confirm")}
          </button>
        </div>
        <p className={styles.modalHelper}>{t("docs.supersede.helper")}</p>
      </div>
    </div>
  );
}

function RemoveModal({
  target,
  token,
  onClose,
  onDone,
}: {
  target: DocumentSummary;
  token: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [submitting, setSubmitting] = useState(false);

  async function confirmRemove() {
    if (!token) return;
    setSubmitting(true);
    try {
      await api.post(`/admin/documents/${target.id}/remove`, undefined, token);
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="remove-modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="remove-modal-title">{t("docs.remove.title")}</h2>
        <div className={styles.targetCard}>
          <strong>{target.title}</strong>
          <div className="text-muted">{target.authority ?? "—"}</div>
        </div>

        <p className={styles.modalHelper} style={{ color: "var(--admin-danger)" }}>
          {t("docs.remove.warning")}
        </p>

        <div className={styles.modalActions}>
          <button className="btn btn-secondary" onClick={onClose}>
            {t("docs.supersede.cancel")}
          </button>
          <button
            className="btn"
            style={{ background: "var(--admin-danger)", color: "var(--color-text-on-primary)", borderColor: "var(--admin-danger)" }}
            disabled={submitting}
            onClick={confirmRemove}
          >
            {t("docs.remove.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

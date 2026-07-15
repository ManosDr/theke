"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { useVertical } from "../lib/vertical";
import type { BrowseResponse, DocumentSummary, VerticalSummary } from "../lib/types";
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

const STATUS_ICON: Record<string, string> = {
  active: "●",
  superseded: "🔗",
  needs_review: "●",
  manual_entry: "✎",
  reference_only: "👁",
  manual_entry_pending: "⏱",
  removed: "✗",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, debouncedQ, activeVerticalId, status, authority, contentType, supersededOnly, offset]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQ, activeVerticalId, status, authority, contentType, supersededOnly]);

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

  const hasFilters = Boolean(debouncedQ || status || authority || contentType || supersededOnly || verticalFilter);

  function clearFilters() {
    setQ("");
    setStatus("");
    setAuthority("");
    setContentType("");
    setSupersededOnly(false);
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
  }

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
      </div>

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
                  <th>{tUpper("docs.colStatus")}</th>
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
                    <tr key={doc.id} className={eff === "superseded" ? styles.rowSuperseded : ""}>
                      <td>
                        <button type="button" className={styles.titleText} style={{ background: "none", border: "none", textAlign: "left", padding: 0, cursor: "pointer" }} onClick={() => setDrawerDoc(doc)}>
                          {doc.title ?? "—"}
                        </button>
                        {doc.replaced_by && (
                          <span className={styles.replacementCaption}>
                            {t("docs.replacedBy", { title: doc.replaced_by.title ?? `#${doc.replaced_by.id}` })}
                          </span>
                        )}
                        {doc.replaces && (
                          <span className={styles.replacementCaption}>
                            {t("docs.replaces", { title: doc.replaces.title ?? `#${doc.replaces.id}` })}
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
                          {STATUS_ICON[eff]} {t(`docs.status.${eff}` as TranslationKey)}
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
                    {STATUS_ICON[effectiveStatus(drawerDoc)]} {t(`docs.status.${effectiveStatus(drawerDoc)}` as TranslationKey)}
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
            style={{ background: "var(--admin-danger)", color: "#fff", borderColor: "var(--admin-danger)" }}
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

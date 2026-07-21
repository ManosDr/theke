"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "../components/AppShell";
import MessagePackUpsell from "../components/MessagePackUpsell";
import { ThumbDownIcon, ThumbUpIcon } from "../components/StatIcons";
import { PinIcon, WarningIcon } from "../components/UiIcons";
import { ApiError, api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { highlightMatches, renderMarkedSnippet } from "../lib/highlight";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type {
  ChatCitation,
  ChatHistoryResponse,
  ChatMessageResponse,
  ChatRateLimitStatus,
  DocumentSummary,
  FeedbackRating,
  MyCompanySummary,
  ProjectSummary,
  RegionSummary,
  SubscriptionStatusResponse,
} from "../lib/types";
import styles from "./chat.module.css";

interface Message {
  role: "user" | "assistant";
  text: string;
  citations?: ChatCitation[];
  gap?: boolean | null;
  // Underlying chat_sessions row id - only assistant messages that actually
  // got logged (not the empty-question early return) carry one; feedback
  // controls need it to call POST /chat/feedback.
  sessionId?: number | null;
  feedback?: FeedbackRating | null;
  feedbackError?: boolean;
  // Epoch ms - from ChatHistoryItem.created_at when restored, or Date.now()
  // when a message is added live. Session-separator grouping and "Νέα
  // Εκκίνηση" divider placement both key off this, not off array index.
  createdAt: number;
}

// Messages, not conversational turns - caps what's sent to the completion
// as context, not what's shown on screen (the full history stays visible).
const MAX_HISTORY_MESSAGES = 10;

// A gap of more than this between two consecutive messages starts a new
// visual "session" in the timeline - purely a display grouping, computed
// client-side from timestamps already on every message; no schema change.
const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

function isUnverified(status: string | null): boolean {
  return status === "reference_only" || status === "manual_entry_pending";
}

interface Divider {
  index: number; // renders immediately before messages[index]
  label: string;
}

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string;

function formatSessionLabel(atMs: number, locale: string, t: TFunc): string {
  const date = new Date(atMs);
  const now = new Date();
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) {
    return `${t("chat.sessionToday")}, ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `${t("chat.sessionYesterday")}, ${time}`;
  }
  const dateStr = date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  return `${dateStr}, ${time}`;
}

// Merges two divider sources into one sorted list: natural gaps (every
// message run gets its own leading label, not just the ones after a gap -
// including the very first run) and explicit "Νέα Εκκίνηση" restart points.
// A restart at the same index as a natural gap wins - it's the more
// specific, deliberate event.
function computeDividers(
  messages: Message[],
  restarts: { index: number; at: number }[],
  locale: string,
  t: TFunc
): Divider[] {
  const byIndex = new Map<number, Divider>();
  if (messages.length > 0) {
    byIndex.set(0, { index: 0, label: formatSessionLabel(messages[0].createdAt, locale, t) });
  }
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].createdAt - messages[i - 1].createdAt > SESSION_GAP_MS) {
      byIndex.set(i, { index: i, label: formatSessionLabel(messages[i].createdAt, locale, t) });
    }
  }
  for (const r of restarts) {
    const time = new Date(r.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    byIndex.set(r.index, { index: r.index, label: t("chat.newStartDivider", { time }) });
  }
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

function ChatContent() {
  const { user } = useAuth();
  const { t, tUpper, locale } = useLocale();
  const token = user?.token ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Session separators/restart tracking - purely frontend state, reset on
  // every history reload (project switch, page refresh) by design: a
  // returning engineer gets full context back, see chat page's Phase 2 spec.
  const [restarts, setRestarts] = useState<{ index: number; at: number }[]>([]);
  const [sessionStartIndex, setSessionStartIndex] = useState(0);

  function startNewSession() {
    setRestarts((prev) => [...prev, { index: messages.length, at: Date.now() }]);
    setSessionStartIndex(messages.length);
  }

  // Thumbs-down opens this inline form instead of saving immediately -
  // thumbs-up still saves right away (see the two buttons' onClick below).
  const [dislikePromptIndex, setDislikePromptIndex] = useState<number | null>(null);
  const [dislikeText, setDislikeText] = useState("");

  const [rateLimitStatus, setRateLimitStatus] = useState<ChatRateLimitStatus | null>(null);
  function refreshRateLimitStatus() {
    if (!token) return;
    api
      .get<ChatRateLimitStatus>("/chat/rate-limit-status", token)
      .then(setRateLimitStatus)
      .catch(() => setRateLimitStatus(null));
  }
  useEffect(refreshRateLimitStatus, [token]);

  // Monthly message-pool usage - distinct from the hourly rate limit above:
  // that one resets every hour and applies per-user, this one resets
  // monthly and is shared across the whole company (see check_subscription
  // in the backend, which returns the 402 this mirrors proactively).
  const [poolStatus, setPoolStatus] = useState<SubscriptionStatusResponse | null>(null);
  function refreshPoolStatus() {
    if (!token || !user?.companyId) return;
    api
      .get<SubscriptionStatusResponse>("/subscription/status", token)
      .then(setPoolStatus)
      .catch(() => setPoolStatus(null));
  }
  useEffect(refreshPoolStatus, [token, user?.companyId]);
  const poolExhausted = !!poolStatus && !poolStatus.is_beta && poolStatus.messages_used >= poolStatus.messages_limit;

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [kbQuery, setKbQuery] = useState("");
  const [kbResults, setKbResults] = useState<DocumentSummary[]>([]);
  const [company, setCompany] = useState<MyCompanySummary | null>(null);

  useEffect(() => {
    if (!token || !user?.companyId) return;
    api
      .get<MyCompanySummary>("/companies/me", token)
      .then(setCompany)
      .catch(() => setCompany(null));
  }, [token, user?.companyId]);

  // Collapse preference persists per session (not permanently) - a user who
  // knows their location data doesn't want it taking space every visit,
  // but a fresh session defaults back to showing it once.
  const [locationExpanded, setLocationExpanded] = useState(true);
  const [archaeologicalExpanded, setArchaeologicalExpanded] = useState(false);
  useEffect(() => {
    const stored = sessionStorage.getItem("theke-location-strip-expanded");
    if (stored !== null) setLocationExpanded(stored === "true");
  }, []);
  function toggleLocationStrip() {
    setLocationExpanded((prev) => {
      sessionStorage.setItem("theke-location-strip-expanded", String(!prev));
      return !prev;
    });
  }

  useEffect(() => {
    if (!token) return;
    api
      .get<ProjectSummary[]>("/projects", token)
      .then((data) => {
        setProjects(data);
        // A project's own "Συνομιλία" link deep-links here as
        // /chat?project_id=N - honor it over the default project so opening
        // chat from inside a project actually scopes to that project, not
        // whichever one happens to be marked default.
        const requestedId = Number(new URLSearchParams(window.location.search).get("project_id"));
        const requested = requestedId ? data.find((p) => p.id === requestedId) : undefined;
        if (requested) {
          setSelectedProjectId(requested.id);
          return;
        }
        const def = data.find((p) => p.is_default);
        setSelectedProjectId(def ? def.id : null);
      })
      .catch(() => setProjects([]));
    // Region names for the persistent "Έργο: ... | Περιοχή: ..." label below -
    // ProjectSummary only carries region_id, not the display name.
    api
      .get<RegionSummary[]>("/projects/regions", token)
      .then(setRegions)
      .catch(() => setRegions([]));
  }, [token]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedRegionName = selectedProject?.region_id
    ? (regions.find((r) => r.region_id === selectedProject.region_id)?.region_name_el ?? null)
    : null;

  // Per-project chat view: switching projects re-scopes both retrieval
  // (region comes from the project on the backend) and which conversation
  // is shown - each project's history is its own thread, not one shared feed.
  useEffect(() => {
    if (!token) return;
    setHistoryLoading(true);
    const params = new URLSearchParams();
    if (selectedProjectId != null) params.set("project_id", String(selectedProjectId));
    api
      .get<ChatHistoryResponse>(`/chat/history?${params.toString()}`, token)
      .then((data) => {
        const restored: Message[] = [];
        for (const item of data.items) {
          const createdAt = new Date(item.created_at).getTime();
          restored.push({ role: "user", text: item.message, createdAt });
          restored.push({
            role: "assistant",
            text: item.response,
            citations: item.citations,
            gap: item.gap,
            sessionId: item.id,
            createdAt,
          });
        }
        setMessages(restored);
        // A returning engineer gets full history AND full LLM context back -
        // any "Νέα Εκκίνηση" from a prior visit was frontend-only and never
        // persisted, by design (see Phase 2 spec).
        setRestarts([]);
        setSessionStartIndex(0);
      })
      .catch(() => setMessages([]))
      .finally(() => setHistoryLoading(false));
  }, [token, selectedProjectId]);

  const dividers = useMemo(() => computeDividers(messages, restarts, locale, t), [messages, restarts, locale, t]);
  const dividerByIndex = useMemo(() => new Map(dividers.map((d) => [d.index, d])), [dividers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(overrideText?: string) {
    const question = (overrideText ?? input).trim();
    if (!question || loading || poolExhausted) return;

    // Only messages from the current session (after the last "Νέα
    // Εκκίνηση") are eligible context - within that, still capped to the
    // last MAX_HISTORY_MESSAGES for the completion's context window.
    const history = messages
      .slice(sessionStartIndex)
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.text }));

    setMessages((prev) => [...prev, { role: "user", text: question, createdAt: Date.now() }]);
    setInput("");
    setLoading(true);

    try {
      const data = await api.post<ChatMessageResponse>(
        "/chat/message",
        {
          query: question,
          conversation_history: history,
          project_id: selectedProjectId ?? undefined,
        },
        token
      );
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer,
          citations: data.citations,
          gap: data.gap,
          sessionId: data.session_id,
          createdAt: Date.now(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: err instanceof ApiError ? err.message : "Error reaching the backend.",
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
      refreshRateLimitStatus();
      refreshPoolStatus();
    }
  }

  async function submitFeedback(
    messageIndex: number,
    sessionId: number,
    rating: FeedbackRating,
    feedbackText?: string | null
  ) {
    // Optimistic lock first - the buttons disable immediately on click, no
    // confirmation dialog per spec. Rolled back (feedbackError shown, lock
    // lifted) only if the request actually fails.
    setMessages((prev) => prev.map((m, i) => (i === messageIndex ? { ...m, feedback: rating, feedbackError: false } : m)));
    try {
      await api.post(
        "/chat/feedback",
        { session_id: sessionId, message_index: messageIndex, rating, feedback_text: feedbackText ?? null },
        token
      );
    } catch {
      setMessages((prev) =>
        prev.map((m, i) => (i === messageIndex ? { ...m, feedback: null, feedbackError: true } : m))
      );
    }
  }

  function openDislikePrompt(messageIndex: number) {
    setDislikePromptIndex(messageIndex);
    setDislikeText("");
  }

  function skipDislikePrompt(messageIndex: number, sessionId: number) {
    submitFeedback(messageIndex, sessionId, "negative", null);
    setDislikePromptIndex(null);
  }

  function submitDislikePrompt(messageIndex: number, sessionId: number) {
    submitFeedback(messageIndex, sessionId, "negative", dislikeText);
    setDislikePromptIndex(null);
  }

  async function searchKb(e: React.FormEvent) {
    e.preventDefault();
    if (!kbQuery.trim() || !token) return;
    const project = projects.find((p) => p.id === selectedProjectId);
    const params = new URLSearchParams({ q: kbQuery });
    if (project?.municipality) params.set("municipality", project.municipality);
    const results = await api.get<DocumentSummary[]>(`/documents/search?${params.toString()}`, token);
    setKbResults(results);
  }

  const accountTypeKey: TranslationKey =
    user?.companyType === "municipality"
      ? "register.typeMunicipality"
      : user?.companyType === "construction"
        ? "register.typeConstruction"
        : user?.companyType === "accounting"
          ? "register.typeAccounting"
          : "dash.super.platform";

  return (
    <div className={styles.layout}>
      <div className={`card ${styles.chatPanel}`}>
        <div className={styles.disclaimerCompact} title={company?.vertical_disclaimer_text || t("chat.disclaimer")}>
          {company?.vertical_disclaimer_text || t("chat.disclaimer")}
        </div>

        {((poolStatus && !poolStatus.is_beta && poolStatus.messages_used / Math.max(poolStatus.messages_limit, 1) >= 0.8) ||
          (rateLimitStatus && rateLimitStatus.used >= 15)) && (
          <div className={styles.chatHeaderBar}>
            <div className={styles.headerControls}>
              {poolStatus && !poolStatus.is_beta && poolStatus.messages_used / Math.max(poolStatus.messages_limit, 1) >= 0.8 && (
                <span
                  className={styles.rateLimitIndicator}
                  data-level={poolExhausted ? "danger" : "warning"}
                >
                  {t("chat.poolWarningLabel", { used: poolStatus.messages_used, limit: poolStatus.messages_limit })}
                </span>
              )}
              {rateLimitStatus && rateLimitStatus.used >= 15 && (
                <span
                  className={styles.rateLimitIndicator}
                  data-level={
                    rateLimitStatus.remaining === 0 ? "danger" : rateLimitStatus.remaining <= 3 ? "warning" : "normal"
                  }
                >
                  {t("chat.rateLimitLabel", { used: rateLimitStatus.used, limit: rateLimitStatus.limit })}
                  {rateLimitStatus.remaining <= 5 &&
                    t("chat.rateLimitReset", { minutes: Math.ceil(rateLimitStatus.resets_in_seconds / 60) })}
                </span>
              )}
            </div>
          </div>
        )}

        {poolStatus && !poolStatus.is_beta && (
          <MessagePackUpsell
            messagesUsed={poolStatus.messages_used}
            messagesLimit={poolStatus.messages_limit}
            isBeta={poolStatus.is_beta}
            token={token}
          />
        )}

        <div className={styles.messages}>
          {historyLoading && <p className="text-muted">{t("chat.loadingHistory")}</p>}
          {!historyLoading && messages.length === 0 && (
            <>
              <p className={styles.emptyState}>{company?.vertical_welcome_message || t("chat.placeholder")}</p>
              <p className={styles.emptyStateHint}>{t("chat.emptyStateHint")}</p>
              {company && !company.company_has_messages && (
                <p className={styles.emptyStateHint}>
                  {t("chat.firstSessionHintPrefix")}{" "}
                  <Link href="/help">{t("chat.firstSessionHintLink")}</Link>.
                </p>
              )}
            </>
          )}
          {messages.map((m, i) => (
            <Fragment key={i}>
              {dividerByIndex.has(i) && (
                <div className={styles.sessionDivider}>
                  <span>{dividerByIndex.get(i)!.label}</span>
                </div>
              )}
              <div
                className={`${styles.message} ${m.role === "user" ? styles.messageUser : styles.messageAssistant}`}
              >
              {m.gap && <div className={styles.gapBadge}>{tUpper("chat.gapLabel")}</div>}
              {m.text}
              {m.citations && m.citations.length > 0 && (
                <>
                  <ul className={styles.citations}>
                    {m.citations.map((c, j) => (
                      <li key={c.document_id}>
                        [{j + 1}]{" "}
                        {c.source_url ? (
                          <a href={c.source_url} target="_blank" rel="noreferrer" className={styles.citationLink}>
                            {c.title ?? t("chat.untitledSource")}
                          </a>
                        ) : (
                          <span className={styles.citationLink}>{c.title ?? t("chat.untitledSource")}</span>
                        )}
                        {c.authority && <span className="text-muted"> — {c.authority}</span>}
                        {(c.contact_phone || c.contact_email) && (
                          <span className="text-muted">
                            {" "}
                            ({[c.contact_phone, c.contact_email].filter(Boolean).join(", ")})
                          </span>
                        )}
                        {isUnverified(c.extraction_status) && (
                          <span className={styles.pendingBadge}>{t("chat.pendingVerification")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {/* ydom (building/planning office) is the authority zone-
                      coefficient and setback figures actually come from - the
                      closest reliable signal available on a citation for
                      "this may need engineer confirmation," short of a
                      dedicated content_type value that doesn't exist yet. */}
                  {m.citations.some((c) => c.authority === "ydom") && (
                    <p className={styles.zoneCaveat}>{t("chat.zoneCaveat")}</p>
                  )}
                </>
              )}
              {m.role === "assistant" && m.gap === false && m.sessionId != null && (
                <div className={styles.feedbackRow}>
                  <button
                    type="button"
                    className={`${styles.feedbackButton} ${m.feedback === "positive" ? styles.feedbackButtonPositive : ""} ${m.feedback === "negative" ? styles.feedbackButtonDimmed : ""}`}
                    onClick={() => {
                      if (dislikePromptIndex === i) setDislikePromptIndex(null);
                      submitFeedback(i, m.sessionId as number, "positive");
                    }}
                    aria-label={t("chat.feedbackPositive")}
                  >
                    <ThumbUpIcon size={18} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.feedbackButton} ${m.feedback === "negative" ? styles.feedbackButtonNegative : ""} ${m.feedback === "positive" ? styles.feedbackButtonDimmed : ""}`}
                    onClick={() => openDislikePrompt(i)}
                    aria-label={t("chat.feedbackNegative")}
                  >
                    <ThumbDownIcon size={18} />
                  </button>
                  {m.feedbackError && <span className={styles.feedbackError}>{t("chat.feedbackError")}</span>}
                </div>
              )}
              {dislikePromptIndex === i && m.sessionId != null && (
                <div className={styles.dislikePrompt}>
                  <p className={styles.dislikePromptTitle}>{t("chat.feedbackPromptTitle")}</p>
                  <textarea
                    className="input"
                    rows={2}
                    autoFocus
                    value={dislikeText}
                    placeholder={t("chat.feedbackPromptPlaceholder")}
                    onChange={(e) => setDislikeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") skipDislikePrompt(i, m.sessionId as number);
                    }}
                  />
                  <div className={styles.dislikePromptActions}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => skipDislikePrompt(i, m.sessionId as number)}
                    >
                      {t("chat.feedbackSkip")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => submitDislikePrompt(i, m.sessionId as number)}
                    >
                      {t("chat.feedbackSubmit")}
                    </button>
                  </div>
                </div>
              )}
              </div>
            </Fragment>
          ))}
          {/* A restart's divider index equals messages.length at the moment
             it's clicked - nothing in the .map() above ever renders it until
             a new message pushes the array past that point. Render it here
             so "Νέα Εκκίνηση" shows its divider immediately, not only after
             the next message is sent. */}
          {dividers
            .filter((d) => d.index >= messages.length)
            .map((d) => (
              <div key={`trailing-${d.index}`} className={styles.sessionDivider}>
                <span>{d.label}</span>
              </div>
            ))}
          {loading && <p className="text-muted">{t("chat.thinking")}</p>}
          <div ref={messagesEndRef} />
        </div>

        {poolExhausted && <p className={styles.poolExhaustedNotice}>{t("chat.poolExhausted")}</p>}
        <div className={styles.composer}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={t("chat.inputPlaceholder")}
            disabled={poolExhausted}
          />
          <button className="btn btn-primary" onClick={() => sendMessage()} disabled={loading || poolExhausted}>
            {t("chat.send")}
          </button>
          <button type="button" className={styles.newSessionButton} onClick={startNewSession}>
            {t("chat.newStart")}
          </button>
        </div>
      </div>

      <aside className={styles.sidebar}>
        <section className={`card ${styles.sidebarSection}`}>
          <h3>{tUpper("chat.yourContext")}</h3>
          <div className={styles.contextRow}>
            <span className="text-muted">{t("chat.role")}</span>
            <span>{user ? t(`role.${user.role}` as TranslationKey) : ""}</span>
          </div>
          <div className={styles.contextRow}>
            <span className="text-muted">{t("chat.accountType")}</span>
            <span>{t(accountTypeKey)}</span>
          </div>
          {projects.length > 0 ? (
            <div style={{ marginTop: "var(--space-3)" }}>
              <label htmlFor="project-select" className="text-muted" style={{ fontSize: "0.85rem" }}>
                {t("chat.selectProject")}
              </label>
              <select
                id="project-select"
                className="input"
                style={{ marginTop: "var(--space-1)" }}
                value={selectedProjectId ?? ""}
                onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{t("chat.noProjectsOption")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.municipality})
                  </option>
                ))}
              </select>
              {selectedRegionName && (
                <div className={styles.contextRow}>
                  <span className="text-muted">{t("chat.regionLabel")}</span>
                  <span>{selectedRegionName}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted" style={{ fontSize: "0.85rem" }}>
              {t("chat.noDefaultProject")}
            </p>
          )}

          {selectedProject && selectedProject.lat != null && selectedProject.lon != null && (
            <div className={styles.locationStrip}>
              <button type="button" className={styles.locationStripToggle} onClick={toggleLocationStrip}>
                <PinIcon size={13} />
                {locationExpanded ? t("chat.locationStrip.collapse") : t("chat.locationStrip.expand")}
              </button>
              {locationExpanded && (
                <span className={styles.locationStripBody}>
                  {selectedProject.plot_address ?? "—"}
                  {" · "}
                  {t("map.kaek")}: {selectedProject.kaek ?? "—"}
                  {selectedProject.plot_area_sqm != null && ` · ${selectedProject.plot_area_sqm} ${t("map.areaUnit")}`}
                  {selectedProject.archaeological_flag && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className={styles.archaeologicalBadge}
                        onClick={() => setArchaeologicalExpanded((v) => !v)}
                      >
                        <WarningIcon size={12} /> {t("map.archaeologicalWarning")} {archaeologicalExpanded ? "▴" : "▾"}
                      </button>
                    </>
                  )}
                </span>
              )}
              {locationExpanded && selectedProject.archaeological_flag && archaeologicalExpanded && (
                <div className={styles.archaeologicalPanel}>
                  {selectedProject.archaeological_notes && <p>{selectedProject.archaeological_notes}</p>}
                  <p className="text-muted" style={{ fontSize: "0.8rem" }}>
                    {t("map.archaeologicalDisclaimer")}
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => sendMessage(t("chat.locationStrip.askAboutZone"))}
                  >
                    {t("chat.locationStrip.askAboutZone")}
                  </button>
                </div>
              )}
              {locationExpanded && !selectedProject.archaeological_flag && (
                <p className="text-muted" style={{ fontSize: "0.78rem", marginTop: "var(--space-1)" }}>
                  {t("map.noArchaeologicalDataNote")}
                </p>
              )}
            </div>
          )}
        </section>

        <section className={`card ${styles.sidebarSection}`}>
          <h3>{tUpper("chat.quickSearch")}</h3>
          <form onSubmit={searchKb} style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <input
              className="input"
              placeholder={t("chat.searchPlaceholder")}
              value={kbQuery}
              onChange={(e) => setKbQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary">
              {t("chat.go")}
            </button>
          </form>
          {kbResults.map((doc) => (
            <a
              key={doc.id}
              href={`/documents/${doc.id}?q=${encodeURIComponent(kbQuery.trim())}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.searchResult}
            >
              <strong>{highlightMatches(doc.title ?? "", kbQuery)}</strong>
              {doc.snippet && <p className="text-muted">{renderMarkedSnippet(doc.snippet, kbQuery)}…</p>}
            </a>
          ))}
        </section>
      </aside>
    </div>
  );
}

export default function ChatPage() {
  return (
    <RequireAuth>
      <AppShell>
        <ChatContent />
      </AppShell>
    </RequireAuth>
  );
}

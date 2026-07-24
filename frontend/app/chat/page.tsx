"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AppShell } from "../components/AppShell";
import ChatContextCombobox from "../components/ChatContextCombobox";
import { ChatIcon, ChevronIcon, SearchIcon } from "../components/NavIcons";
import { NotificationBell } from "../components/NotificationBell";
import MessagePackUpsell from "../components/MessagePackUpsell";
import { InfoIcon, ThumbDownIcon, ThumbUpIcon } from "../components/StatIcons";
import { UserMenu } from "../components/TopHeader";
import {
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  ExternalLinkIcon,
  PinIcon,
  RefreshIcon,
  SendIcon,
  SparkleIcon,
  WarningIcon,
} from "../components/UiIcons";
import { ApiError, NETWORK_ERROR_STATUS, api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { highlightMatches, renderMarkedSnippet } from "../lib/highlight";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { getInitials } from "../lib/userDisplay";
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

// A real chat completion (RAG retrieval + GPT call) normally finishes well
// under this - past it, on a job site with a spotty connection, hanging
// forever with no feedback is worse than failing with a clear retry path.
const CHAT_TIMEOUT_MS = 30_000;

// A brief interruption (tab switch, screen lock, mobile OS reclaiming a
// backgrounded tab and reloading it on return) shouldn't lose a half-typed
// question - same sessionStorage idiom already used for
// "theke-location-strip-expanded" below, cleared automatically once the
// browser tab/session actually ends, not a permanent offline-storage need.
const CHAT_DRAFT_STORAGE_KEY = "theke-chat-draft";

// A gap of more than this between two consecutive messages starts a new
// visual "session" in the timeline - purely a display grouping, computed
// client-side from timestamps already on every message; no schema change.
const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

// Mobile disclaimer dismiss - same per-session idiom as the draft/
// location-strip keys above, so it reappears on a genuinely new session
// rather than being gone forever after the first tap.
const DISCLAIMER_DISMISS_KEY = "theke-chat-disclaimer-dismissed";

function isUnverified(status: string | null): boolean {
  return status === "reference_only" || status === "manual_entry_pending";
}

// The backend's own system prompt instructs the model to embed inline
// "[1]", "[2]" markers next to the sentence each citation supports (see
// chat.py's prompt) - so `answer` already contains these as plain
// substrings. This turns each marker that has a matching citation into a
// real link to that citation's source_url, per the v2 redesign's inline-
// citation spec; a marker with no matching citation (out-of-range index,
// or no citations at all) is left as plain text rather than guessing.
function renderAnswerBody(text: string, citations: ChatCitation[] | undefined): ReactNode {
  if (!citations || citations.length === 0) return text;
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    const citation = match ? citations[Number(match[1]) - 1] : undefined;
    if (!citation) return <Fragment key={i}>{part}</Fragment>;
    return citation.source_url ? (
      <a key={i} href={citation.source_url} target="_blank" rel="noreferrer" className={styles.inlineCitation}>
        {part}
      </a>
    ) : (
      <span key={i} className={styles.inlineCitation}>
        {part}
      </span>
    );
  });
}

// Vertical-aware, static prompts - not AI-generated per-conversation
// follow-ups (no backend field exists for that; fabricating unrelated
// "follow-up" chips after a real answer in a compliance tool would read as
// a claim the system doesn't back up). These only ever appear pre-
// conversation, in the empty state, as generic starting points.
const SUGGESTION_KEYS: Record<"construction" | "accounting" | "generic", TranslationKey[]> = {
  construction: ["chat.suggestionConstruction1", "chat.suggestionConstruction2", "chat.suggestionConstruction3"],
  accounting: ["chat.suggestionAccounting1", "chat.suggestionAccounting2", "chat.suggestionAccounting3"],
  generic: ["chat.suggestionGeneric1", "chat.suggestionGeneric2", "chat.suggestionGeneric3"],
};

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

// Mobile-only compact header for the Chat page specifically (swapped in via
// AppShell's `mobileHeader` prop, below its 640px breakpoint) - hamburger
// stays the existing fixed Sidebar trigger (this bar just leaves it room,
// see .mobileTopBar's padding-left), title + context-sheet trigger +
// notifications/avatar replace TopHeader's row, which also drops the
// breadcrumb/font-scale controls that don't fit a 56px bar anyway.
// Language, theme, and font-scale all move into the nav drawer's settings
// section (see Sidebar.tsx's mobileSettingsSection) to keep this row to
// navigation + account-critical actions only, not preference controls.
function ChatMobileTopBar({ onOpenSheet }: { onOpenSheet: () => void }) {
  const { t } = useLocale();

  return (
    <div className={styles.mobileTopBar}>
      <span className={styles.mobileTopBarTitle}>{t("nav.chat")}</span>
      <div className={styles.mobileTopBarActions}>
        <button
          type="button"
          className={styles.mobileIconButton}
          onClick={onOpenSheet}
          aria-label={t("chat.contextSearchTitle")}
        >
          <InfoIcon size={16} />
        </button>
        <NotificationBell />
        <UserMenu />
      </div>
    </div>
  );
}

function ChatContent({ sheetOpen, onOpenSheet, onCloseSheet }: { sheetOpen: boolean; onOpenSheet: () => void; onCloseSheet: () => void }) {
  const { user } = useAuth();
  const { t, tUpper, locale } = useLocale();
  const token = user?.token ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Swipe-down-to-close on the sheet's drag handle - a plain touch-delta
  // threshold, not a full drag-follows-finger gesture library; closes once
  // a downward swipe clears SWIPE_CLOSE_THRESHOLD_PX, same as tapping the
  // handle/scrim/close button.
  const sheetTouchStartY = useRef<number | null>(null);
  function handleSheetTouchStart(e: React.TouchEvent) {
    sheetTouchStartY.current = e.touches[0]?.clientY ?? null;
  }
  function handleSheetTouchEnd(e: React.TouchEvent) {
    const startY = sheetTouchStartY.current;
    sheetTouchStartY.current = null;
    const endY = e.changedTouches[0]?.clientY;
    if (startY != null && endY != null && endY - startY > 60) onCloseSheet();
  }

  // Restore a draft left over from before an interruption (see
  // CHAT_DRAFT_STORAGE_KEY above) - runs once on mount, before the user
  // could have typed anything new, so there's no risk of clobbering a
  // fresh keystroke.
  useEffect(() => {
    const stored = sessionStorage.getItem(CHAT_DRAFT_STORAGE_KEY);
    if (stored) setInput(stored);
  }, []);

  // Mirrors every keystroke to sessionStorage - clears the stored draft
  // once input empties (message sent, or manually cleared), so a
  // successfully sent question doesn't reappear as a stale draft next time.
  useEffect(() => {
    if (input) sessionStorage.setItem(CHAT_DRAFT_STORAGE_KEY, input);
    else sessionStorage.removeItem(CHAT_DRAFT_STORAGE_KEY);
  }, [input]);

  // Mobile-only condensed disclaimer's dismiss state - desktop's own
  // disclaimer has no dismiss control and always shows (see render below),
  // this only governs the mobile row.
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(false);
  useEffect(() => {
    setDisclaimerDismissed(sessionStorage.getItem(DISCLAIMER_DISMISS_KEY) === "true");
  }, []);
  function dismissDisclaimer() {
    sessionStorage.setItem(DISCLAIMER_DISMISS_KEY, "true");
    setDisclaimerDismissed(true);
  }

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

  // The pinned default project - distinct from selectedProject/selectedProjectId,
  // which is this session's current context and may differ from the pin
  // (e.g. after a session-only switch, or before any switch on a fresh load
  // where they start out equal). Refetches after any pin change instead of
  // reusing the mount effect above, so a pin change never re-runs that
  // effect's URL-param/auto-select logic and silently reassigns the active
  // session context.
  const pinnedProject = projects.find((p) => p.is_default) ?? null;
  function refetchProjects() {
    if (!token) return;
    api
      .get<ProjectSummary[]>("/projects", token)
      .then(setProjects)
      .catch(() => {});
  }
  const [pickingDefault, setPickingDefault] = useState(false);

  function handleSwitchContext(project: ProjectSummary | null) {
    setSelectedProjectId(project ? project.id : null);
  }

  async function handlePickDefault(project: ProjectSummary | null) {
    if (!token) return;
    if (project) {
      await api.post(`/projects/${project.id}/default`, undefined, token);
    } else if (pinnedProject) {
      await api.del(`/projects/${pinnedProject.id}/default`, token);
    }
    setPickingDefault(false);
    refetchProjects();
  }

  async function handleUsePublicInstead() {
    if (!token || !pinnedProject) return;
    await api.del(`/projects/${pinnedProject.id}/default`, token);
    refetchProjects();
  }

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
          preferred_locale: locale,
        },
        token,
        CHAT_TIMEOUT_MS
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
      const isNetworkError = err instanceof ApiError && err.status === NETWORK_ERROR_STATUS;
      // A timeout/connection drop never reached the backend, so nothing
      // was actually sent - restore the question to the input instead of
      // leaving it stranded only in the (already-posted) message bubble
      // above, so retrying is one tap on Send, not a retype.
      if (isNetworkError) setInput(question);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: isNetworkError ? t("chat.networkError") : err instanceof ApiError ? err.message : t("chat.networkError"),
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

  // Copy-to-clipboard feedback button - new in the v2 redesign, no backend
  // involvement. copiedIndex flips the icon to a checkmark for 1.5s as
  // confirmation, then reverts; keyed by message index like the other
  // per-message feedback state above.
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  async function copyAnswer(messageIndex: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(messageIndex);
      setTimeout(() => setCopiedIndex((cur) => (cur === messageIndex ? null : cur)), 1500);
    } catch {
      // Clipboard access denied/unavailable - silently no-op, same as this
      // page's other best-effort UI conveniences.
    }
  }

  // Source-row rendering shared between the clickable (<a>, has a real
  // source_url) and static (<div>, no URL yet) cases - keeps the existing
  // contact-info/pending-verification-badge display alongside the new
  // numbered-badge/tag-pill/external-link-icon row layout.
  function renderSourceRow(c: ChatCitation, index: number) {
    const inner = (
      <>
        <span className={styles.sourceBadge}>{index + 1}</span>
        <span className={styles.sourceBody}>
          <span className={styles.sourceTitle}>{c.title ?? t("chat.untitledSource")}</span>
          {(c.contact_phone || c.contact_email) && (
            <span className={styles.sourceMeta}>{[c.contact_phone, c.contact_email].filter(Boolean).join(", ")}</span>
          )}
        </span>
        {c.authority && <span className={styles.sourceTag}>{c.authority}</span>}
        {isUnverified(c.extraction_status) && <span className={styles.pendingBadge}>{t("chat.pendingVerification")}</span>}
        <span className={styles.sourceExt}>
          <ExternalLinkIcon size={14} />
        </span>
      </>
    );
    return c.source_url ? (
      <a key={c.document_id} href={c.source_url} target="_blank" rel="noreferrer" className={styles.sourceRow}>
        {inner}
      </a>
    ) : (
      <div key={c.document_id} className={`${styles.sourceRow} ${styles.sourceRowStatic}`}>
        {inner}
      </div>
    );
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

  // Municipalities have no project/customer concept at all (no
  // project-creation UI exists for them - see MemberDashboard's identical
  // check). The pin/switcher block below assumes an account has projects or
  // customers to pin/switch between, which is a structural mismatch for
  // this account type, not an empty state - so it's replaced with a static
  // scope statement instead of the pin UI or the "create a project" nudge.
  const isMunicipality = user?.companyType === "municipality";

  const accountTypeKey: TranslationKey =
    user?.companyType === "municipality"
      ? "register.typeMunicipality"
      : user?.companyType === "construction"
        ? "register.typeConstruction"
        : user?.companyType === "accounting"
          ? "register.typeAccounting"
          : "dash.super.platform";

  // Keyed off the company's actual vertical (construction/tax_accounting),
  // not user.companyType directly - a municipality's companyType is
  // "municipality", not "construction", but its vertical_slug is still
  // "construction", so it should see the same real construction examples
  // as any other construction-vertical company. Only super_admin (no
  // company at all) falls through to the vertical-blind "generic" set.
  const verticalSlug = company?.vertical_slug;
  const suggestionKeys =
    SUGGESTION_KEYS[verticalSlug === "tax_accounting" ? "accounting" : verticalSlug === "construction" ? "construction" : "generic"];

  // Context-aware empty-state chips - only when a specific project/customer
  // context is active (selectedProject), only for the true empty state (see
  // render site below), never the "ongoing quick-start row" that repeats
  // suggestionKeys under an active thread. Tax-vertical projects (a Project
  // row wrapping a Customer, see customer_id) simply don't carry
  // archaeological_flag/plot_in_plan/region_id, so they fall through to the
  // generic vertical-aware chips below without a separate tax-specific
  // branch - there's currently nothing customer-level distinctive enough to
  // build a chip from (see the fix's own spec).
  const emptyStateChips: string[] = (() => {
    if (!selectedProject) return suggestionKeys.map((key) => t(key));
    const candidates: string[] = [];
    if (selectedProject.archaeological_flag) candidates.push(t("chat.suggestionContextArchaeological"));
    if (selectedProject.plot_in_plan === true) candidates.push(t("chat.suggestionContextPlotInsidePlan"));
    else if (selectedProject.plot_in_plan === false) candidates.push(t("chat.suggestionContextPlotOutsidePlan"));
    if (selectedProject.region_id) {
      const region = regions.find((r) => r.region_id === selectedProject.region_id);
      const regionName = region ? (locale === "en" ? region.region_name_en : region.region_name_el) : null;
      if (regionName) candidates.push(t("chat.suggestionContextRegion", { region: regionName }));
    }
    return candidates.length > 0 ? candidates.slice(0, 3) : suggestionKeys.map((key) => t(key));
  })();

  const disclaimerText =
    (locale === "en" ? company?.vertical_disclaimer_text_en : null) ||
    company?.vertical_disclaimer_text ||
    t("chat.disclaimer");
  const initials = getInitials(user?.firstName, user?.lastName, user?.email);
  const contextStripLabel = `${t(accountTypeKey)} · ${selectedProject ? selectedProject.name : t("chat.noProjectContext")} — ${t("chat.tapForContextSearch")}`;

  // "YOUR CONTEXT" + "QUICK DOCUMENT SEARCH" - identical content, rendered
  // in two different places (desktop's always-visible right panel, and
  // mobile's bottom sheet). A plain closure rather than its own component:
  // it reads a dozen+ locals from ChatContent directly instead of needing
  // them all threaded through as props. idSuffix keeps the <select>/<label>
  // pairing valid HTML when both copies exist in the DOM at once (one just
  // CSS-hidden per breakpoint, see chat.module.css).
  function contextSearchPanel(idSuffix: string) {
    return (
      <>
        <section className={`card ${styles.sidebarSection}`}>
          <h3>{tUpper("chat.yourContext")}</h3>

          {isMunicipality ? (
            // Municipalities structurally have no project/customer concept
            // (no project-creation UI exists for them at all) - the pin and
            // switcher below don't apply, and neither does the "create a
            // project" nudge, since creating one isn't a real next action
            // for this account type.
            <div className={styles.contextPinBlock}>
              <p className="text-muted" style={{ fontSize: "0.85rem" }}>
                {t("chat.context.municipalityScope")}
              </p>
            </div>
          ) : (
            <>
              {/* Makes the pin's effect on chat's opening context explicit and
                  self-documenting, rather than something discovered only by
                  noticing which context chat happened to open in. */}
              <div className={styles.contextPinBlock}>
                {pinnedProject ? (
                  <>
                    <div className={styles.contextRow}>
                      <span className="text-muted">{t("chat.context.pinnedPrefix")}</span>
                      <span>{pinnedProject.customer_name || pinnedProject.name}</span>
                    </div>
                    <p className="text-muted" style={{ fontSize: "0.82rem" }}>
                      {t("chat.context.pinnedHint")}
                    </p>
                    <div className={styles.contextPinActions}>
                      <button type="button" className="btn btn-secondary" onClick={() => setPickingDefault(true)}>
                        {t("chat.context.changeDefault")}
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={handleUsePublicInstead}>
                        {t("chat.context.usePublicInstead")}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.contextRow}>
                      <span className="text-muted">{t("chat.context.pinnedPrefix")}</span>
                      <span>{t("chat.context.publicOption")}</span>
                    </div>
                    <p className="text-muted" style={{ fontSize: "0.82rem" }}>
                      {t("chat.context.unpinnedHint")}
                    </p>
                    {projects.length > 0 ? (
                      <button type="button" className="btn btn-secondary" onClick={() => setPickingDefault(true)}>
                        {t("chat.context.setDefault")}
                      </button>
                    ) : (
                      <p className="text-muted" style={{ fontSize: "0.8rem" }}>
                        {t("chat.context.noProjectsHint")}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Session-only context switcher - deliberately labeled/styled
                  distinct from the pin block above (different heading, no
                  "προεπιλογή" wording) since this changes only the CURRENT
                  conversation's scope, not the next fresh page load's. Reuses
                  the same ChatContextCombobox instance for the "set/change
                  default" actions above, per pickingDefault - never a second
                  picker component. */}
              {projects.length > 0 && (
                <div className={styles.contextSwitcher}>
                  <label className="text-muted" style={{ fontSize: "0.85rem" }}>
                    {pickingDefault ? t("chat.context.setDefault") : t("chat.context.switchLabel")}
                  </label>
                  {!pickingDefault && (
                    <p className="text-muted" style={{ fontSize: "0.78rem" }}>
                      {t("chat.context.switchHint")}
                    </p>
                  )}
                  <ChatContextCombobox
                    projects={projects}
                    regions={regions}
                    placeholder={t("chat.context.switchPlaceholder")}
                    onSelect={pickingDefault ? handlePickDefault : handleSwitchContext}
                  />
                  {pickingDefault ? (
                    <button type="button" className={styles.linkButton} onClick={() => setPickingDefault(false)}>
                      {t("common.cancel")}
                    </button>
                  ) : selectedProject ? (
                    <div className={styles.activeProjectChip}>
                      <div style={{ minWidth: 0 }}>
                        <div className={styles.activeProjectChipLabel}>{t("chat.projectLabel")}</div>
                        <div className={styles.activeProjectChipValue}>
                          {selectedProject.customer_name || selectedProject.name}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.activeProjectChipClear}
                        onClick={() => setSelectedProjectId(null)}
                        aria-label={t("common.cancel")}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className={styles.contextRow}>
                      <span>{t("chat.projectLabel")}</span>
                      <span>{t("chat.context.publicOption")}</span>
                    </div>
                  )}
                  {selectedRegionName && (
                    <div className={styles.contextRow}>
                      <span className="text-muted">{t("chat.regionLabel")}</span>
                      <span>{selectedRegionName}</span>
                    </div>
                  )}
                </div>
              )}
            </>
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
                  {(() => {
                    const notes =
                      (locale === "en" ? selectedProject.archaeological_notes_en : null) ||
                      selectedProject.archaeological_notes;
                    return notes && <p>{notes}</p>;
                  })()}
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
          <form onSubmit={searchKb} className={styles.searchInputWrap} style={{ marginBottom: "var(--space-3)" }}>
            <span className={styles.searchInputIcon}>
              <SearchIcon size={16} />
            </span>
            <input
              className="input"
              placeholder={t("chat.searchPlaceholder")}
              value={kbQuery}
              onChange={(e) => setKbQuery(e.target.value)}
            />
            <button type="submit" className={styles.searchSubmitButton} aria-label={t("chat.go")}>
              <ArrowRightIcon size={15} />
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
      </>
    );
  }

  return (
    <div className={styles.pageWrap}>
      {/* Full-width, above both columns - the design's own "static
          disclaimer" position (see chat.module.css's own comment). Content
          is get_disclaimer()'s real output via disclaimerText above; only
          this container's position/styling changed. */}
      <div className={styles.disclaimerBar} title={disclaimerText}>
        <InfoIcon size={16} />
        <span>{disclaimerText}</span>
      </div>

      <div className={styles.layout}>
      <div className={styles.chatPanel}>
        {/* Mobile-only condensed row with its own dismiss, see
            DISCLAIMER_DISMISS_KEY above - hidden entirely (not just
            visually) once dismissed, and hidden by CSS above 640px
            regardless, where .disclaimerBar covers it instead. */}
        {!disclaimerDismissed && (
          <div className={styles.disclaimerMobile} title={disclaimerText}>
            <InfoIcon size={12} />
            <span>{disclaimerText}</span>
            <button
              type="button"
              className={styles.disclaimerDismissButton}
              onClick={dismissDisclaimer}
              aria-label={t("chat.close")}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        )}

        {/* Mobile-only - opens the context/search bottom sheet, replacing
            the always-in-flow right panel that doesn't fit this width. */}
        <button type="button" className={styles.mobileContextStrip} onClick={onOpenSheet}>
          <span className={styles.mobileContextStripAvatar}>{initials}</span>
          <span className={styles.mobileContextStripText}>{contextStripLabel}</span>
          <ChevronIcon size={14} />
        </button>

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

        <div className={styles.messagesScroll}>
          <div className={styles.messages}>
          {historyLoading && <p className="text-muted">{t("chat.loadingHistory")}</p>}
          {!historyLoading && messages.length === 0 && (
            <div className={styles.emptyStateWrap}>
              <div className={styles.emptyStateIcon}>
                <ChatIcon size={24} />
              </div>
              <p className={styles.emptyState}>
                {(locale === "en" ? company?.vertical_welcome_message_en : null) ||
                  company?.vertical_welcome_message ||
                  t("chat.placeholder")}
              </p>
              <div className={styles.suggestionChips}>
                {emptyStateChips.map((text) => (
                  <button
                    key={text}
                    type="button"
                    className={styles.suggestionChip}
                    onClick={() => setInput(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className={styles.emptyStateHint}>{t("chat.emptyStateHint")}</p>
              <p className={styles.emptyStateHintMobile}>{t("chat.emptyStateHintMobile")}</p>
              {company && !company.company_has_messages && (
                <p className={styles.emptyStateHint}>
                  {t("chat.firstSessionHintPrefix")}{" "}
                  <Link href="/help">{t("chat.firstSessionHintLink")}</Link>.
                </p>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <Fragment key={i}>
              {dividerByIndex.has(i) && (
                <div className={styles.sessionDivider}>
                  <span>{dividerByIndex.get(i)!.label}</span>
                </div>
              )}
              {m.role === "user" ? (
                <div className={`${styles.message} ${styles.messageUser}`}>{m.text}</div>
              ) : (
                <div className={`${styles.message} ${styles.messageAssistant}`}>
                  <div className={styles.assistantHeader}>
                    <span className={styles.assistantAvatar}>
                      <SparkleIcon size={15} />
                    </span>
                    <span className={styles.assistantName}>theke</span>
                    {/* Fires only for this specific answer's own gap signal
                        (the same low-confidence signal the old .gapBadge
                        used) - never a global/page-level indicator. */}
                    {m.gap && (
                      <span className={styles.limitedSourcesTag}>
                        <WarningIcon size={12} />
                        <span>{tUpper("chat.gapLabel")}</span>
                      </span>
                    )}
                  </div>
                  <div className={styles.messageBody}>{renderAnswerBody(m.text, m.citations)}</div>
                  {m.citations && m.citations.length > 0 && (
                    <div className={styles.sourcesBlock}>
                      <div className={styles.sourcesLabel}>{t("chat.sources", { count: m.citations.length })}</div>
                      <div className={styles.sourcesList}>{m.citations.map((c, j) => renderSourceRow(c, j))}</div>
                      {/* ydom (building/planning office) is the authority
                          zone-coefficient and setback figures actually come
                          from - the closest reliable signal available on a
                          citation for "this may need engineer confirmation,"
                          short of a dedicated content_type value that
                          doesn't exist yet. */}
                      {m.citations.some((c) => c.authority === "ydom") && (
                        <p className={styles.zoneCaveat}>{t("chat.zoneCaveat")}</p>
                      )}
                    </div>
                  )}
                  {m.gap === false && m.sessionId != null && (
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
                        <ThumbUpIcon size={16} />
                      </button>
                      <button
                        type="button"
                        className={`${styles.feedbackButton} ${m.feedback === "negative" ? styles.feedbackButtonNegative : ""} ${m.feedback === "positive" ? styles.feedbackButtonDimmed : ""}`}
                        onClick={() => openDislikePrompt(i)}
                        aria-label={t("chat.feedbackNegative")}
                      >
                        <ThumbDownIcon size={16} />
                      </button>
                      <button
                        type="button"
                        className={styles.feedbackButton}
                        onClick={() => copyAnswer(i, m.text)}
                        aria-label={copiedIndex === i ? t("chat.copied") : t("chat.copyAnswer")}
                        title={copiedIndex === i ? t("chat.copied") : t("chat.copyAnswer")}
                      >
                        {copiedIndex === i ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
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
              )}
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
          {/* Same static per-vertical prompts as the empty state's own
              chips (not per-conversation AI-generated follow-ups - see
              SUGGESTION_KEYS' own comment on why), repeated once below the
              active thread as an ongoing quick-start row, left-aligned to
              the thread's own left edge rather than centered. */}
          {!historyLoading && !loading && messages.length > 0 && (
            <div className={styles.followupChips}>
              <div className={styles.followupChipsLabel}>{t("chat.suggestedQuestions")}</div>
              <div className={styles.followupChipsRow}>
                {suggestionKeys.map((key) => (
                  <button key={key} type="button" className={styles.suggestionChip} onClick={() => setInput(t(key))}>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
          </div>
        </div>

        {poolExhausted && <p className={styles.poolExhaustedNotice}>{t("chat.poolExhausted")}</p>}

        <div className={styles.composerBar}>
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

        {/* Mobile-only rebuild: circular icon targets (44px min tap size)
            in one row instead of the desktop composer's text-label
            buttons, which got cramped at phone widths. */}
        <div className={styles.composerMobile}>
          <button
            type="button"
            className={styles.composerIconButton}
            onClick={startNewSession}
            aria-label={t("chat.newStart")}
          >
            <RefreshIcon size={18} />
          </button>
          <input
            className={styles.composerMobileInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={t("chat.inputPlaceholder")}
            disabled={poolExhausted}
          />
          <button
            type="button"
            className={`${styles.composerIconButton} ${styles.composerSendButton}`}
            onClick={() => sendMessage()}
            disabled={loading || poolExhausted}
            aria-label={t("chat.send")}
          >
            <SendIcon size={18} />
          </button>
        </div>
      </div>

      <aside className={styles.sidebar}>{contextSearchPanel("desktop")}</aside>
      </div>

      {/* Mobile-only bottom sheet - same content as the desktop <aside>
          above (see contextSearchPanel), reached via the context strip
          under the disclaimer or the top bar's info icon instead of always
          being in-flow, since there's no room for a 270px right column at
          phone widths. */}
      <div
        className={`${styles.sheetScrim} ${sheetOpen ? styles.sheetScrimOpen : ""}`}
        onClick={onCloseSheet}
        aria-hidden="true"
      />
      <div className={`${styles.sheet} ${sheetOpen ? styles.sheetOpenState : ""}`} role="dialog" aria-modal="true">
        <button
          type="button"
          className={styles.sheetHandle}
          onClick={onCloseSheet}
          onTouchStart={handleSheetTouchStart}
          onTouchEnd={handleSheetTouchEnd}
          aria-label={t("chat.close")}
        />
        <div className={styles.sheetBody}>
          <div className={styles.sheetHeader}>
            <span>{t("chat.contextSearchTitle")}</span>
            <button type="button" className={styles.sheetCloseButton} onClick={onCloseSheet} aria-label={t("chat.close")}>
              <CloseIcon size={16} />
            </button>
          </div>
          {contextSearchPanel("mobile")}
        </div>
      </div>
    </div>
  );
}

function ChatShellWrapper() {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <AppShell edgeToEdge mobileHeader={<ChatMobileTopBar onOpenSheet={() => setSheetOpen(true)} />}>
      <ChatContent sheetOpen={sheetOpen} onOpenSheet={() => setSheetOpen(true)} onCloseSheet={() => setSheetOpen(false)} />
    </AppShell>
  );
}

export default function ChatPage() {
  return (
    <RequireAuth>
      <ChatShellWrapper />
    </RequireAuth>
  );
}

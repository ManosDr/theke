"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "../components/AppShell";
import { ApiError, api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type {
  ChatCitation,
  ChatHistoryResponse,
  ChatMessageResponse,
  DocumentSummary,
  FeedbackRating,
  ProjectSummary,
  RegionSummary,
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
}

// Messages, not conversational turns - caps what's sent to the completion
// as context, not what's shown on screen (the full history stays visible).
const MAX_HISTORY_MESSAGES = 10;

function isUnverified(status: string | null): boolean {
  return status === "reference_only" || status === "manual_entry_pending";
}

function ChatContent() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [kbQuery, setKbQuery] = useState("");
  const [kbResults, setKbResults] = useState<DocumentSummary[]>([]);

  useEffect(() => {
    if (!token) return;
    api
      .get<ProjectSummary[]>("/projects", token)
      .then((data) => {
        setProjects(data);
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
          restored.push({ role: "user", text: item.message });
          restored.push({
            role: "assistant",
            text: item.response,
            citations: item.citations,
            gap: item.gap,
            sessionId: item.id,
          });
        }
        setMessages(restored);
      })
      .catch(() => setMessages([]))
      .finally(() => setHistoryLoading(false));
  }, [token, selectedProjectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) return;

    const history = messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.text }));

    setMessages((prev) => [...prev, { role: "user", text: question }]);
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
        { role: "assistant", text: data.answer, citations: data.citations, gap: data.gap, sessionId: data.session_id },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: err instanceof ApiError ? err.message : "Error reaching the backend." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function submitFeedback(messageIndex: number, sessionId: number, rating: FeedbackRating) {
    // Optimistic lock first - the buttons disable immediately on click, no
    // confirmation dialog per spec. Rolled back (feedbackError shown, lock
    // lifted) only if the request actually fails.
    setMessages((prev) => prev.map((m, i) => (i === messageIndex ? { ...m, feedback: rating, feedbackError: false } : m)));
    try {
      await api.post("/chat/feedback", { session_id: sessionId, message_index: messageIndex, rating }, token);
    } catch {
      setMessages((prev) =>
        prev.map((m, i) => (i === messageIndex ? { ...m, feedback: null, feedbackError: true } : m))
      );
    }
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
        : "dash.super.platform";

  return (
    <div className={styles.layout}>
      <div className={`card ${styles.chatPanel}`}>
        <div className={styles.disclaimerBanner}>{t("chat.disclaimer")}</div>

        {selectedProject && (
          <div className={styles.projectContextBar}>
            {t("chat.projectLabel")}: {selectedProject.name}
            {selectedRegionName && (
              <>
                {" "}| {t("chat.regionLabel")}: {selectedRegionName}
              </>
            )}
          </div>
        )}

        <div className={styles.messages}>
          {historyLoading && <p className="text-muted">{t("chat.loadingHistory")}</p>}
          {!historyLoading && messages.length === 0 && <p className="text-muted">{t("chat.placeholder")}</p>}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`${styles.message} ${m.role === "user" ? styles.messageUser : styles.messageAssistant}`}
            >
              {m.gap && <div className={styles.gapBadge}>{t("chat.gapLabel")}</div>}
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
                    className={`${styles.feedbackButton} ${m.feedback === "positive" ? styles.feedbackButtonActive : ""}`}
                    disabled={m.feedback != null}
                    onClick={() => submitFeedback(i, m.sessionId as number, "positive")}
                    aria-label={t("chat.feedbackPositive")}
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    className={`${styles.feedbackButton} ${m.feedback === "negative" ? styles.feedbackButtonActive : ""}`}
                    disabled={m.feedback != null}
                    onClick={() => submitFeedback(i, m.sessionId as number, "negative")}
                    aria-label={t("chat.feedbackNegative")}
                  >
                    👎
                  </button>
                  {m.feedbackError && <span className={styles.feedbackError}>{t("chat.feedbackError")}</span>}
                </div>
              )}
            </div>
          ))}
          {loading && <p className="text-muted">{t("chat.thinking")}</p>}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.composer}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={t("chat.inputPlaceholder")}
          />
          <button className="btn btn-primary" onClick={sendMessage} disabled={loading}>
            {t("chat.send")}
          </button>
        </div>
      </div>

      <aside className={styles.sidebar}>
        <section className={`card ${styles.sidebarSection}`}>
          <h3>{t("chat.yourContext")}</h3>
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
            </div>
          ) : (
            <p className="text-muted" style={{ fontSize: "0.85rem" }}>
              {t("chat.noDefaultProject")}
            </p>
          )}
        </section>

        <section className={`card ${styles.sidebarSection}`}>
          <h3>{t("chat.quickSearch")}</h3>
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
            <div key={doc.id} className={styles.searchResult}>
              <strong>{doc.title}</strong>
              {doc.snippet && <p className="text-muted">{doc.snippet.slice(0, 120)}…</p>}
            </div>
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

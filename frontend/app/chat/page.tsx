"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "../components/AppShell";
import { ApiError, api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import type { DocumentSummary, ProjectSummary } from "../lib/types";
import styles from "./chat.module.css";

interface Message {
  role: "user" | "assistant";
  text: string;
  citations?: string[];
}

interface ChatResponse {
  answer: string;
  citations: string[];
}

function ChatContent() {
  const { user } = useAuth();
  const token = user?.token ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [kbQuery, setKbQuery] = useState("");
  const [kbResults, setKbResults] = useState<DocumentSummary[]>([]);

  useEffect(() => {
    if (!token) return;
    api
      .get<ProjectSummary[]>("/projects", token)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      const defaultProject = projects.find((p) => p.is_default);
      const data = await api.post<ChatResponse>(
        "/chat",
        { message: question, project_id: defaultProject?.id },
        token
      );
      setMessages((prev) => [...prev, { role: "assistant", text: data.answer, citations: data.citations }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: err instanceof ApiError ? err.message : "Error reaching the backend." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function searchKb(e: React.FormEvent) {
    e.preventDefault();
    if (!kbQuery.trim() || !token) return;
    const municipality = projects.find((p) => p.is_default)?.municipality ?? undefined;
    const params = new URLSearchParams({ q: kbQuery });
    if (municipality) params.set("municipality", municipality);
    const results = await api.get<DocumentSummary[]>(`/documents/search?${params.toString()}`, token);
    setKbResults(results);
  }

  const defaultProjects = projects.filter((p) => p.is_default);

  return (
    <div className={styles.layout}>
      <div className={`card ${styles.chatPanel}`}>
        <div className={styles.messages}>
          {messages.length === 0 && (
            <p className="text-muted">
              Ask e.g. &ldquo;Τι δικαιολογητικά χρειάζομαι για χτίσιμο μονοκατοικίας στην Καβάλα;&rdquo;
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`${styles.message} ${m.role === "user" ? styles.messageUser : styles.messageAssistant}`}>
              {m.text}
              {m.citations && m.citations.length > 0 && (
                <ul className={styles.citations}>
                  {m.citations.map((c, j) => (
                    <li key={j}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {loading && <p className="text-muted">Thinking…</p>}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.composer}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Ask a question…"
          />
          <button className="btn btn-primary" onClick={sendMessage} disabled={loading}>
            Send
          </button>
        </div>
      </div>

      <aside className={styles.sidebar}>
        <section className={`card ${styles.sidebarSection}`}>
          <h3>Your context</h3>
          <div className={styles.contextRow}>
            <span className="text-muted">Role</span>
            <span>{user?.role}</span>
          </div>
          <div className={styles.contextRow}>
            <span className="text-muted">Account type</span>
            <span>{user?.companyType ?? "platform"}</span>
          </div>
          {defaultProjects.length > 0 ? (
            defaultProjects.map((p) => (
              <div className={styles.contextRow} key={p.id}>
                <span className="text-muted">{p.name}</span>
                <span>{p.municipality}</span>
              </div>
            ))
          ) : (
            <p className="text-muted" style={{ fontSize: "0.85rem" }}>
              No default project set. Mark one in your dashboard to auto-scope municipality context.
            </p>
          )}
        </section>

        <section className={`card ${styles.sidebarSection}`}>
          <h3>Quick document search</h3>
          <form onSubmit={searchKb} style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <input
              className="input"
              placeholder="Search…"
              value={kbQuery}
              onChange={(e) => setKbQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary">
              Go
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

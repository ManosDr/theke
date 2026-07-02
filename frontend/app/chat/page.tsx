"use client";

import { useState } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
  citations?: string[];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer, citations: data.citations },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Error reaching the backend. Is it running?" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 24px" }}>
      <h1>theke chat</h1>
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, minHeight: 300 }}>
        {messages.length === 0 && (
          <p style={{ color: "#888" }}>
            Ask e.g. &ldquo;Τι δικαιολογητικά χρειάζομαι για χτίσιμο μονοκατοικίας στην Καβάλα;&rdquo;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ margin: "12px 0" }}>
            <strong>{m.role === "user" ? "You" : "theke"}:</strong> {m.text}
            {m.citations && m.citations.length > 0 && (
              <ul>
                {m.citations.map((c, j) => (
                  <li key={j}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {loading && <p style={{ color: "#888" }}>Thinking&hellip;</p>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask a question..."
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={sendMessage} disabled={loading}>
          Send
        </button>
      </div>
    </main>
  );
}

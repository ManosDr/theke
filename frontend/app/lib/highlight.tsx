import type { ReactNode } from "react";

/** Wraps every case-insensitive occurrence of `term` in `text` with <mark>,
 * so a user can immediately spot why a search result matched. */
export function highlightMatches(text: string, term: string): ReactNode {
  const trimmed = term.trim();
  if (!trimmed) return text;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;

  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

// Matches the backend's HIGHLIGHT_START/HIGHLIGHT_END markers in
// app/routers/documents.py's ts_headline snippets. Greek full-text search
// matches word stems (a query like "αδειας" matches "άδεια", "αδειών",
// etc.), so a literal substring search on the raw snippet text can't
// reliably find what Postgres actually matched - the backend marks the
// real match position instead and we just render it.
const MARK_START = "\x01";
const MARK_END = "\x02";

/** Renders text containing \x01/\x02-delimited marked segments (from a
 * backend ts_headline snippet) as <mark> spans, falling back to a plain
 * literal highlight of `fallbackTerm` if no markers are present. */
export function renderMarkedSnippet(text: string, fallbackTerm?: string): ReactNode {
  if (!text.includes(MARK_START)) {
    return fallbackTerm ? highlightMatches(text, fallbackTerm) : text;
  }
  const parts = text.split(new RegExp(`[${MARK_START}${MARK_END}]`));
  // Segments alternate plain/marked starting from index 1, matching how
  // StartSel/StopSel bracket each match in the ts_headline output.
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

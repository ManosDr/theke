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

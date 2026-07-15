"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { DocTypeBadge } from "../../components/TypeBadge";
import { ApiError, api } from "../../lib/api";
import { RequireAuth, useAuth } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";
import type { TranslationKey } from "../../lib/translations";
import type { DocumentDetail } from "../../lib/types";
import styles from "./page.module.css";

/** Splits `content` on every case-insensitive occurrence of `term`, so the
 * caller can render each match as its own element (needed for per-match
 * refs/active-state, unlike the simpler lib/highlight.tsx helpers). */
function findMatches(content: string, term: string): { parts: string[]; matchCount: number } {
  const trimmed = term.trim();
  if (!trimmed) return { parts: [content], matchCount: 0 };
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = content.split(new RegExp(`(${escaped})`, "gi"));
  return { parts, matchCount: Math.floor(parts.length / 2) };
}

function DocumentContent() {
  const { user } = useAuth();
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const backHref = searchParams.get("from") || "/sources";
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findTerm, setFindTerm] = useState(searchParams.get("q") ?? "");
  const [activeMatch, setActiveMatch] = useState(0);
  const matchRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    api
      .get<DocumentDetail>(`/documents/${params.id}`, user?.token)
      .then(setDoc)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load document"));
  }, [params.id, user?.token]);

  const { parts, matchCount } = useMemo(
    () => findMatches(doc?.content ?? "", findTerm),
    [doc?.content, findTerm]
  );

  useEffect(() => {
    setActiveMatch(0);
  }, [findTerm, doc?.content]);

  useEffect(() => {
    if (matchCount === 0) return;
    matchRefs.current[activeMatch]?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [activeMatch, matchCount, parts]);

  function goToMatch(delta: number) {
    if (matchCount === 0) return;
    setActiveMatch((i) => (i + delta + matchCount) % matchCount);
  }

  function handleFindKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    goToMatch(e.shiftKey ? -1 : 1);
  }

  if (error) return <p>{error}</p>;
  if (!doc) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <Link href={backHref} className={styles.backLink}>
        {t("doc.back")}
      </Link>

      <div className={styles.header}>
        <h1>{doc.title}</h1>
        {doc.source && (
          <a href={doc.source} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            {t("doc.openOriginal")}
          </a>
        )}
      </div>

      <div className={styles.metaRow}>
        {doc.source_group && <span>{doc.source_group}</span>}
        {doc.doc_type && <DocTypeBadge docType={doc.doc_type}>{t(`docType.${doc.doc_type}` as TranslationKey)}</DocTypeBadge>}
        {doc.date && <span>{doc.date}</span>}
        {doc.identifier && <span>{doc.identifier}</span>}
        {doc.series && doc.issue_number && (
          <span>
            ΦΕΚ {doc.series} {doc.issue_number}
          </span>
        )}
        {doc.municipality && <span>{doc.municipality}</span>}
      </div>

      {doc.content && (
        <div className={styles.findBar}>
          <input
            className="input"
            type="text"
            value={findTerm}
            onChange={(e) => setFindTerm(e.target.value)}
            onKeyDown={handleFindKeyDown}
            placeholder={t("doc.find.placeholder")}
          />
          <span className={styles.findCount}>
            {findTerm.trim()
              ? matchCount > 0
                ? t("doc.find.matchCount", { current: activeMatch + 1, total: matchCount })
                : t("doc.find.noMatches")
              : ""}
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => goToMatch(-1)} disabled={matchCount === 0}>
            {t("doc.find.prev")}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => goToMatch(1)} disabled={matchCount === 0}>
            {t("doc.find.next")}
          </button>
        </div>
      )}

      <div className="card">
        {doc.content ? (
          <div className={styles.content}>
            {parts.map((part, i) => {
              if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
              const matchIndex = (i - 1) / 2;
              return (
                <mark
                  key={i}
                  ref={(el) => {
                    matchRefs.current[matchIndex] = el;
                  }}
                  className={matchIndex === activeMatch ? styles.activeMatch : undefined}
                >
                  {part}
                </mark>
              );
            })}
          </div>
        ) : (
          <p className="text-muted" style={{ padding: "var(--space-5)" }}>
            {t("doc.noContent")}
          </p>
        )}
      </div>
    </div>
  );
}

export default function DocumentDetailPage() {
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <DocumentContent />
        </Suspense>
      </AppShell>
    </RequireAuth>
  );
}

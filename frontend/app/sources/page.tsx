"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AppShell } from "../components/AppShell";
import { api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { BrowseResponse, DocumentSummary, SourceGroupSummary } from "../lib/types";
import styles from "./sources.module.css";

const PAGE_SIZE = 20;

function SourceButtons() {
  const { user } = useAuth();
  const { t } = useLocale();
  const [sources, setSources] = useState<SourceGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<SourceGroupSummary[]>("/documents/sources", user?.token)
      .then(setSources)
      .finally(() => setLoading(false));
  }, [user?.token]);

  if (loading) return <p className="text-muted">{t("sources.loading")}</p>;
  if (sources.length === 0) return <p className={styles.emptyState}>{t("sources.none")}</p>;

  return (
    <div className={styles.buttonGrid}>
      {sources.map((s) => (
        <Link key={s.group} href={`/sources?group=${encodeURIComponent(s.group)}`} className={`card ${styles.sourceButton}`}>
          <span className={styles.sourceName}>{s.group}</span>
          <span className={styles.sourceCount}>{t("sources.documentsCount", { count: s.count })}</span>
        </Link>
      ))}
    </div>
  );
}

function SourceListing({ group }: { group: string }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(0);
  }, [group]);

  useEffect(() => {
    const params = new URLSearchParams({ group, limit: String(PAGE_SIZE), offset: String(offset) });
    api.get<BrowseResponse>(`/documents/browse?${params.toString()}`, user?.token).then(setData);
  }, [group, offset, user?.token]);

  return (
    <div>
      <Link href="/sources" className={styles.backLink}>
        {t("sources.allSources")}
      </Link>
      <h1>{group}</h1>

      {!data ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : data.items.length === 0 ? (
        <p className={styles.emptyState}>{t("sources.noDocuments")}</p>
      ) : (
        <div className="card" style={{ padding: "var(--space-4)" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("sources.colDate")}</th>
                <th>{t("sources.colTitle")}</th>
                <th>{t("sources.colIdentifier")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((doc: DocumentSummary) => (
                <tr key={doc.id}>
                  <td className="text-muted">{doc.date ?? "—"}</td>
                  <td>{doc.title}</td>
                  <td className="text-muted">{doc.identifier ?? [doc.series, doc.issue_number].filter(Boolean).join(" ") || "—"}</td>
                  <td style={{ display: "flex", gap: "var(--space-2)" }}>
                    <Link href={`/documents/${doc.id}`} className="btn btn-secondary">
                      {t("common.read")}
                    </Link>
                    {doc.source && (
                      <a href={doc.source} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                        {t("common.original")}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.pagination}>
            <button className="btn btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              {t("common.previous")}
            </button>
            <span className="text-muted">
              {t("common.paginationRange", {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, data.total),
                total: data.total,
              })}
            </span>
            <button
              className="btn btn-secondary"
              disabled={offset + PAGE_SIZE >= data.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t("common.next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SourcesContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const group = searchParams.get("group");

  if (group) return <SourceListing group={group} />;

  return (
    <div>
      <h1>{t("sources.title")}</h1>
      <p className="text-muted">{t("sources.description")}</p>
      <div style={{ marginTop: "var(--space-5)" }}>
        <SourceButtons />
      </div>
    </div>
  );
}

export default function SourcesPage() {
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <SourcesContent />
        </Suspense>
      </AppShell>
    </RequireAuth>
  );
}

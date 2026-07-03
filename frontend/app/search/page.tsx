"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "../components/AppShell";
import { api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { BrowseResponse, SourceGroupSummary } from "../lib/types";
import styles from "./search.module.css";

const PAGE_SIZE = 20;
const DOC_TYPES: { value: string; labelKey: TranslationKey }[] = [
  { value: "law", labelKey: "docType.law" },
  { value: "circular", labelKey: "docType.circular" },
  { value: "reference", labelKey: "docType.reference" },
  { value: "guide", labelKey: "docType.guide" },
  { value: "upload", labelKey: "docType.upload" },
];

function SearchContent() {
  const { user } = useAuth();
  const { t } = useLocale();

  const [q, setQ] = useState("");
  const [docType, setDocType] = useState("");
  const [group, setGroup] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);

  const [sources, setSources] = useState<SourceGroupSummary[]>([]);
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<SourceGroupSummary[]>("/documents/sources", user?.token).then(setSources);
  }, [user?.token]);

  async function runSearch(nextOffset = 0) {
    setLoading(true);
    setOffset(nextOffset);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
    if (q.trim()) params.set("q", q.trim());
    if (docType) params.set("doc_type", docType);
    if (group) params.set("group", group);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    try {
      const result = await api.get<BrowseResponse>(`/documents/browse?${params.toString()}`, user?.token);
      setData(result);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(0);
  }

  return (
    <div>
      <h1>{t("search.title")}</h1>
      <p className="text-muted">{t("search.description")}</p>

      <form className={`card ${styles.filters}`} onSubmit={handleSubmit}>
        <div className={styles.filterField}>
          <label htmlFor="q">{t("search.term")}</label>
          <input id="q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.termPlaceholder")} />
        </div>

        <div className={styles.filterField}>
          <label htmlFor="source">{t("search.source")}</label>
          <select id="source" className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">{t("search.allSources")}</option>
            {sources.map((s) => (
              <option key={s.group} value={s.group}>
                {s.group}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label htmlFor="docType">{t("search.type")}</label>
          <select id="docType" className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">{t("search.allTypes")}</option>
            {DOC_TYPES.map((dt) => (
              <option key={dt.value} value={dt.value}>
                {t(dt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label htmlFor="dateFrom">{t("search.from")}</label>
          <input id="dateFrom" type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>

        <div className={styles.filterField}>
          <label htmlFor="dateTo">{t("search.to")}</label>
          <input id="dateTo" type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? t("common.searching") : t("common.search")}
        </button>
      </form>

      {!data ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : data.items.length === 0 ? (
        <p className={styles.emptyState}>{t("common.noMatches")}</p>
      ) : (
        <div className="card" style={{ padding: "var(--space-4)" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("sources.colDate")}</th>
                <th>{t("sources.colTitle")}</th>
                <th>{t("search.colSource")}</th>
                <th>{t("search.colType")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((doc) => (
                <tr key={doc.id}>
                  <td className="text-muted">{doc.date ?? "—"}</td>
                  <td>
                    {doc.title}
                    {doc.snippet && <p className="text-muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>{doc.snippet.slice(0, 160)}…</p>}
                  </td>
                  <td className="text-muted">{doc.source_group ?? "—"}</td>
                  <td className="text-muted">{doc.doc_type ? t(`docType.${doc.doc_type}` as TranslationKey) : "—"}</td>
                  <td>
                    <Link href={`/documents/${doc.id}`} className="btn btn-secondary">
                      {t("common.read")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.pagination}>
            <button className="btn btn-secondary" disabled={offset === 0} onClick={() => runSearch(Math.max(0, offset - PAGE_SIZE))}>
              {t("common.previous")}
            </button>
            <span className="text-muted">
              {t("common.paginationRange", {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, data.total),
                total: data.total,
              })}
            </span>
            <button className="btn btn-secondary" disabled={offset + PAGE_SIZE >= data.total} onClick={() => runSearch(offset + PAGE_SIZE)}>
              {t("common.next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <RequireAuth>
      <AppShell>
        <SearchContent />
      </AppShell>
    </RequireAuth>
  );
}

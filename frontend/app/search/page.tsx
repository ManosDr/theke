"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { AppShell } from "../components/AppShell";
import { DocTypeBadge } from "../components/TypeBadge";
import { api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { highlightMatches, renderMarkedSnippet } from "../lib/highlight";
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

interface Filters {
  q: string;
  group: string;
  docType: string;
  dateFrom: string;
  dateTo: string;
}

function buildFilterParams(filters: Filters, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.group) params.set("group", filters.group);
  if (filters.docType) params.set("doc_type", filters.docType);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (offset) params.set("offset", String(offset));
  return params;
}

function SearchContent() {
  const { user } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>({
    q: searchParams.get("q") ?? "",
    group: searchParams.get("group") ?? "",
    docType: searchParams.get("doc_type") ?? "",
    dateFrom: searchParams.get("date_from") ?? "",
    dateTo: searchParams.get("date_to") ?? "",
  });
  const [offset, setOffset] = useState(Number(searchParams.get("offset") ?? 0));

  const [sources, setSources] = useState<SourceGroupSummary[]>([]);
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const termDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<SourceGroupSummary[]>("/documents/sources", user?.token).then(setSources);
  }, [user?.token]);

  useEffect(() => () => {
    if (termDebounceRef.current) clearTimeout(termDebounceRef.current);
  }, []);

  async function runSearch(nextFilters: Filters, nextOffset: number) {
    setLoading(true);
    setFilters(nextFilters);
    setOffset(nextOffset);

    const shareParams = buildFilterParams(nextFilters, nextOffset);
    router.replace(`${pathname}${shareParams.toString() ? `?${shareParams.toString()}` : ""}`, { scroll: false });

    const apiParams = new URLSearchParams(shareParams);
    apiParams.set("limit", String(PAGE_SIZE));
    apiParams.set("offset", String(nextOffset));

    try {
      const result = await api.get<BrowseResponse>(`/documents/browse?${apiParams.toString()}`, user?.token);
      setData(result);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch(filters, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(patch: Partial<Filters>) {
    runSearch({ ...filters, ...patch }, 0);
  }

  function handleTermChange(value: string) {
    const nextFilters = { ...filters, q: value };
    setFilters(nextFilters);
    if (termDebounceRef.current) clearTimeout(termDebounceRef.current);
    termDebounceRef.current = setTimeout(() => runSearch(nextFilters, 0), 500);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (termDebounceRef.current) clearTimeout(termDebounceRef.current);
    runSearch(filters, 0);
  }

  const shareQuery = buildFilterParams(filters, offset).toString();
  const fromParam = encodeURIComponent(shareQuery ? `${pathname}?${shareQuery}` : pathname);
  const qParam = filters.q.trim() ? `&q=${encodeURIComponent(filters.q.trim())}` : "";

  return (
    <div>
      <h1>{t("search.title")}</h1>
      <p className="text-muted">{t("search.description")}</p>

      <form className={`card ${styles.filters}`} onSubmit={handleSubmit}>
        <div className={styles.filterField}>
          <label htmlFor="q">{t("search.term")}</label>
          <input
            id="q"
            className="input"
            value={filters.q}
            onChange={(e) => handleTermChange(e.target.value)}
            placeholder={t("search.termPlaceholder")}
          />
        </div>

        <div className={styles.filterField}>
          <label htmlFor="source">{t("search.source")}</label>
          <select id="source" className="input" value={filters.group} onChange={(e) => updateFilter({ group: e.target.value })}>
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
          <select id="docType" className="input" value={filters.docType} onChange={(e) => updateFilter({ docType: e.target.value })}>
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
          <input
            id="dateFrom"
            type="date"
            className="input"
            value={filters.dateFrom}
            onChange={(e) => updateFilter({ dateFrom: e.target.value })}
          />
        </div>

        <div className={styles.filterField}>
          <label htmlFor="dateTo">{t("search.to")}</label>
          <input
            id="dateTo"
            type="date"
            className="input"
            value={filters.dateTo}
            onChange={(e) => updateFilter({ dateTo: e.target.value })}
          />
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
                    {highlightMatches(doc.title ?? "", filters.q)}
                    {doc.snippet && (
                      <p className="text-muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                        {renderMarkedSnippet(doc.snippet, filters.q)}…
                      </p>
                    )}
                  </td>
                  <td className="text-muted">{doc.source_group ?? "—"}</td>
                  <td>{doc.doc_type ? <DocTypeBadge docType={doc.doc_type}>{t(`docType.${doc.doc_type}` as TranslationKey)}</DocTypeBadge> : <span className="text-muted">—</span>}</td>
                  <td>
                    <Link href={`/documents/${doc.id}?from=${fromParam}${qParam}`} className="btn btn-secondary">
                      {t("common.read")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.pagination}>
            <button className="btn btn-secondary" disabled={offset === 0} onClick={() => runSearch(filters, Math.max(0, offset - PAGE_SIZE))}>
              {t("common.previous")}
            </button>
            <span className="text-muted">
              {t("common.paginationRange", {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, data.total),
                total: data.total,
              })}
            </span>
            <button className="btn btn-secondary" disabled={offset + PAGE_SIZE >= data.total} onClick={() => runSearch(filters, offset + PAGE_SIZE)}>
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
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <SearchContent />
        </Suspense>
      </AppShell>
    </RequireAuth>
  );
}

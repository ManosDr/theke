"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AppShell } from "../components/AppShell";
import { api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { BrowseResponse, DocumentSummary, RegionSummary, SourceGroupSummary } from "../lib/types";
import styles from "./sources.module.css";

const PAGE_SIZE = 20;

const AUTHORITIES = ["tee", "ydom", "dasarcheio", "deddie", "deya", "ktimatologio", "aade", "efka", "mida", "other"];
const CONTENT_TYPES = ["procedural_howto", "legal_reference", "regulatory_change_notice", "form", "faq"];

function isUnverified(status: string | null): boolean {
  return status === "reference_only" || status === "manual_entry_pending";
}

interface Filters {
  group: string;
  authority: string;
  contentType: string;
  regionId: string;
}

function buildParams(filters: Filters, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.group) params.set("group", filters.group);
  if (filters.authority) params.set("authority", filters.authority);
  if (filters.contentType) params.set("content_type", filters.contentType);
  if (filters.regionId) params.set("region_id", filters.regionId);
  if (offset) params.set("offset", String(offset));
  return params;
}

function SourcesContent() {
  const { user } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>({
    group: searchParams.get("group") ?? "",
    authority: searchParams.get("authority") ?? "",
    contentType: searchParams.get("content_type") ?? "",
    regionId: searchParams.get("region_id") ?? "",
  });
  const [offset, setOffset] = useState(Number(searchParams.get("offset") ?? 0));

  const [sourceGroups, setSourceGroups] = useState<SourceGroupSummary[]>([]);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [data, setData] = useState<BrowseResponse | null>(null);

  useEffect(() => {
    api
      .get<SourceGroupSummary[]>("/documents/sources", user?.token)
      .then(setSourceGroups)
      .catch(() => setSourceGroups([]));
    api
      .get<RegionSummary[]>("/projects/regions", user?.token)
      .then(setRegions)
      .catch(() => setRegions([]));
  }, [user?.token]);

  async function runQuery(nextFilters: Filters, nextOffset: number) {
    setFilters(nextFilters);
    setOffset(nextOffset);

    const shareParams = buildParams(nextFilters, nextOffset);
    router.replace(`${pathname}${shareParams.toString() ? `?${shareParams.toString()}` : ""}`, { scroll: false });

    const apiParams = new URLSearchParams(shareParams);
    apiParams.set("limit", String(PAGE_SIZE));
    apiParams.set("offset", String(nextOffset));

    const result = await api.get<BrowseResponse>(`/documents/browse?${apiParams.toString()}`, user?.token);
    setData(result);
  }

  useEffect(() => {
    runQuery(filters, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(patch: Partial<Filters>) {
    runQuery({ ...filters, ...patch }, 0);
  }

  const shareQuery = buildParams(filters, offset).toString();
  const fromParam = encodeURIComponent(shareQuery ? `${pathname}?${shareQuery}` : pathname);

  return (
    <div>
      <h1>{t("sources.title")}</h1>
      <p className="text-muted">{t("sources.description")}</p>

      {sourceGroups.length > 0 && (
        <div className={styles.buttonGrid} style={{ marginTop: "var(--space-4)", marginBottom: "var(--space-4)" }}>
          {sourceGroups.map((s) => (
            <button
              key={s.group}
              type="button"
              className={`card ${styles.sourceButton} ${filters.group === s.group ? styles.sourceButtonActive : ""}`}
              onClick={() => updateFilter({ group: filters.group === s.group ? "" : s.group })}
            >
              <span className={styles.sourceName}>{s.group}</span>
              <span className={styles.sourceCount}>{t("sources.documentsCount", { count: s.count })}</span>
            </button>
          ))}
        </div>
      )}

      <div className={`card ${styles.filters}`}>
        <div className={styles.filterField}>
          <label htmlFor="authority">{t("sources.authority")}</label>
          <select
            id="authority"
            className="input"
            value={filters.authority}
            onChange={(e) => updateFilter({ authority: e.target.value })}
          >
            <option value="">{t("sources.allAuthorities")}</option>
            {AUTHORITIES.map((a) => (
              <option key={a} value={a}>
                {t(`authority.${a}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label htmlFor="contentType">{t("sources.contentType")}</label>
          <select
            id="contentType"
            className="input"
            value={filters.contentType}
            onChange={(e) => updateFilter({ contentType: e.target.value })}
          >
            <option value="">{t("sources.allContentTypes")}</option>
            {CONTENT_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`contentType.${c}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label htmlFor="region">{t("sources.region")}</label>
          <select
            id="region"
            className="input"
            value={filters.regionId}
            onChange={(e) => updateFilter({ regionId: e.target.value })}
          >
            <option value="">{t("sources.allRegions")}</option>
            {regions.map((r) => (
              <option key={r.region_id} value={r.region_id}>
                {r.region_name_el}
              </option>
            ))}
          </select>
        </div>
      </div>

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
                <th>{t("sources.colAuthority")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((doc: DocumentSummary) => (
                <tr key={doc.id}>
                  <td className="text-muted">{doc.date ?? "—"}</td>
                  <td>
                    {doc.title}
                    {isUnverified(doc.extraction_status) && (
                      <span className={styles.pendingBadge}>{t("sources.pendingVerification")}</span>
                    )}
                  </td>
                  <td className="text-muted">{doc.authority ? t(`authority.${doc.authority}` as TranslationKey) : "—"}</td>
                  <td style={{ display: "flex", gap: "var(--space-2)" }}>
                    <Link href={`/documents/${doc.id}?from=${fromParam}`} className="btn btn-secondary">
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
            <button
              className="btn btn-secondary"
              disabled={offset === 0}
              onClick={() => runQuery(filters, Math.max(0, offset - PAGE_SIZE))}
            >
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
              onClick={() => runQuery(filters, offset + PAGE_SIZE)}
            >
              {t("common.next")}
            </button>
          </div>
        </div>
      )}
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

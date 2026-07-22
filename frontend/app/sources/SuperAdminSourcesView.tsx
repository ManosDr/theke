"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type {
  BrowseResponse,
  CompanyDocumentsSummary,
  CustomerDocumentsSummary,
  DocumentSummary,
} from "../lib/types";
import styles from "./sources.module.css";

type Tier = "public" | "companies" | "customers";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Shared document-list table - used by all three tiers below, just backed
// by a different endpoint/BrowseResponse each time.
function DocumentTable({ data, emptyMessage }: { data: BrowseResponse | null; emptyMessage: string }) {
  const { t, tUpper } = useLocale();

  if (!data) return <p className="text-muted">{t("common.loading")}</p>;
  if (data.items.length === 0) return <p className={styles.emptyState}>{emptyMessage}</p>;

  return (
    <div className="card" style={{ padding: "var(--space-4)" }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{tUpper("sources.colDate")}</th>
            <th>{tUpper("sources.colTitle")}</th>
            <th>{tUpper("sources.colAuthority")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((doc: DocumentSummary) => (
            <tr key={doc.id}>
              <td className="text-muted">{doc.date ?? "—"}</td>
              <td>{doc.title}</td>
              <td className="text-muted">{doc.authority ?? "—"}</td>
              <td>
                <Link href={`/documents/${doc.id}`} className="btn btn-secondary">
                  {t("common.read")}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Tier 1 - the shared public/national knowledge base (Document.company_id
// IS NULL). Reuses GET /admin/documents, the same endpoint the existing
// "Πηγές Δεδομένων" KB-management screen already uses successfully for
// super_admin - only this tier was ever actually visible to them before
// this view existed.
function PublicTier({ token }: { token: string | null }) {
  const { t } = useLocale();
  const [data, setData] = useState<BrowseResponse | null>(null);

  useEffect(() => {
    setData(null);
    api
      .get<BrowseResponse>("/admin/documents?limit=50", token)
      .then(setData)
      .catch(() => setData({ total: 0, items: [] }));
  }, [token]);

  return (
    <div>
      <p className="text-muted" style={{ marginBottom: "var(--space-4)" }}>
        {t("sources.super.publicDescription")}
      </p>
      <DocumentTable data={data} emptyMessage={t("sources.none")} />
    </div>
  );
}

// Tier 2 - every company's company-wide documents (company_id set,
// project_id and customer_id both NULL), grouped into one tile per company.
function CompaniesTier({ token }: { token: string | null }) {
  const { t, tUpper } = useLocale();
  const [companies, setCompanies] = useState<CompanyDocumentsSummary[] | null>(null);
  const [selected, setSelected] = useState<CompanyDocumentsSummary | null>(null);
  const [docs, setDocs] = useState<BrowseResponse | null>(null);

  useEffect(() => {
    api
      .get<CompanyDocumentsSummary[]>("/admin/companies-documents", token)
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [token]);

  useEffect(() => {
    if (!selected) return;
    setDocs(null);
    api
      .get<BrowseResponse>(`/admin/companies/${selected.company_id}/company-documents?limit=50`, token)
      .then(setDocs)
      .catch(() => setDocs({ total: 0, items: [] }));
  }, [selected, token]);

  if (selected) {
    return (
      <div>
        <button type="button" className={styles.backLink} onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          {t("sources.super.backToCompanies")}
        </button>
        <h2 style={{ marginBottom: "var(--space-1)" }}>{selected.company_name}</h2>
        <p className={`badge ${styles.tierBadgeCompany}`} style={{ marginBottom: "var(--space-4)" }}>
          {t("sources.super.belongsTo", { company: selected.company_name })}
        </p>
        <DocumentTable data={docs} emptyMessage={t("sources.super.noCompanyDocuments")} />
      </div>
    );
  }

  return (
    <div>
      <p className="text-muted" style={{ marginBottom: "var(--space-4)" }}>
        {t("sources.super.companiesDescription")}
      </p>
      {!companies ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : companies.length === 0 ? (
        <p className={styles.emptyState}>{t("sources.super.noCompanies")}</p>
      ) : (
        <div className={styles.buttonGrid}>
          {companies.map((c) => (
            <button
              key={c.company_id}
              type="button"
              className={`card ${styles.sourceButton} ${styles.tileCompany}`}
              onClick={() => setSelected(c)}
            >
              <span className={styles.sourceName}>{c.company_name}</span>
              <span className={styles.sourceCount}>{t("sources.super.documentCount", { count: c.document_count })}</span>
              {c.storage_bytes > 0 && (
                <span className={styles.sourceCount}>{t("sources.super.storageUsed", { size: formatBytes(c.storage_bytes) })}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Tier 3 - customer-scoped documents (customer_id set), reached by picking
// a company first (super_admin has no company of their own, so the
// company has to be chosen explicitly, unlike the tenant-facing customer
// search which defaults to the caller's own company), then searching that
// company's customers by name/ΑΦΜ/phone.
function CustomersTier({ token }: { token: string | null }) {
  const { t, tUpper } = useLocale();
  const [companies, setCompanies] = useState<CompanyDocumentsSummary[] | null>(null);
  const [company, setCompany] = useState<CompanyDocumentsSummary | null>(null);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerDocumentsSummary[] | null>(null);
  const [customer, setCustomer] = useState<CustomerDocumentsSummary | null>(null);
  const [docs, setDocs] = useState<BrowseResponse | null>(null);

  useEffect(() => {
    api
      .get<CompanyDocumentsSummary[]>("/admin/companies-documents", token)
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [token]);

  useEffect(() => {
    if (!company) return;
    setCustomers(null);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    api
      .get<CustomerDocumentsSummary[]>(`/admin/companies/${company.company_id}/customers-documents?${params.toString()}`, token)
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [company, query, token]);

  useEffect(() => {
    if (!customer) return;
    setDocs(null);
    api
      .get<BrowseResponse>(`/admin/customers/${customer.id}/customer-documents?limit=50`, token)
      .then(setDocs)
      .catch(() => setDocs({ total: 0, items: [] }));
  }, [customer, token]);

  if (customer && company) {
    return (
      <div>
        <button type="button" className={styles.backLink} onClick={() => setCustomer(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          {t("sources.super.backToCompany", { company: company.company_name })}
        </button>
        <h2 style={{ marginBottom: "var(--space-1)" }}>{customer.name}</h2>
        <p className={`badge ${styles.tierBadgeCustomer}`} style={{ marginBottom: "var(--space-4)" }}>
          {t("sources.super.customerDetail", { name: customer.name, afm: customer.afm ?? "—" })}
        </p>
        <DocumentTable data={docs} emptyMessage={t("sources.super.noCustomerDocuments")} />
      </div>
    );
  }

  if (company) {
    return (
      <div>
        <button type="button" className={styles.backLink} onClick={() => { setCompany(null); setCustomers(null); setQuery(""); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          {t("sources.super.backToCompanies")}
        </button>
        <h2 style={{ marginBottom: "var(--space-3)" }}>{company.company_name}</h2>
        <input
          className="input"
          style={{ marginBottom: "var(--space-4)", maxWidth: "400px" }}
          placeholder={t("sources.super.searchCustomers")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!customers ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : customers.length === 0 ? (
          <p className={styles.emptyState}>{t("sources.super.noCustomers")}</p>
        ) : (
          <div className={styles.buttonGrid}>
            {customers.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`card ${styles.sourceButton} ${styles.tileCustomer}`}
                onClick={() => setCustomer(c)}
              >
                <span className={styles.sourceName}>{c.name}</span>
                {c.afm && (
                  <span className={styles.sourceCount}>
                    {t("customer.afm")}: {c.afm}
                  </span>
                )}
                <span className={styles.sourceCount}>{t("sources.super.documentCount", { count: c.document_count })}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-muted" style={{ marginBottom: "var(--space-4)" }}>
        {t("sources.super.customersDescription")}
      </p>
      {!companies ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : companies.length === 0 ? (
        <p className={styles.emptyState}>{t("sources.super.noCompanies")}</p>
      ) : (
        <div className={styles.buttonGrid}>
          {companies.map((c) => (
            <button
              key={c.company_id}
              type="button"
              className={`card ${styles.sourceButton} ${styles.tileCustomer}`}
              onClick={() => setCompany(c)}
            >
              <span className={styles.sourceName}>{c.company_name}</span>
              <span className={styles.sourceCount}>{t("sources.super.customerCount", { count: c.customer_count })}</span>
              <span className={styles.sourceCount}>{t("sources.super.viewCustomers")} →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SuperAdminSourcesView() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;
  const [tier, setTier] = useState<Tier>("public");

  const tabs: { key: Tier; label: string; badgeClass: string }[] = [
    { key: "public", label: t("sources.super.publicTier"), badgeClass: styles.tierBadgePublic },
    { key: "companies", label: t("sources.super.companiesTier"), badgeClass: styles.tierBadgeCompany },
    { key: "customers", label: t("sources.super.customersTier"), badgeClass: styles.tierBadgeCustomer },
  ];

  return (
    <div>
      <h1>{t("sources.title")}</h1>

      <div className={styles.tierTabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tierTab} ${tier === tab.key ? styles.tierTabActive : ""}`}
            onClick={() => setTier(tab.key)}
          >
            <span className={`${styles.tierDot} ${tab.badgeClass}`} aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      {tier === "public" && <PublicTier token={token} />}
      {tier === "companies" && <CompaniesTier token={token} />}
      {tier === "customers" && <CustomersTier token={token} />}
    </div>
  );
}

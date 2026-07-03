"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { ApiError, api } from "../../lib/api";
import { RequireAuth, useAuth } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";
import type { TranslationKey } from "../../lib/translations";
import type { DocumentDetail } from "../../lib/types";
import styles from "./page.module.css";

function DocumentContent() {
  const { user } = useAuth();
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DocumentDetail>(`/documents/${params.id}`, user?.token)
      .then(setDoc)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load document"));
  }, [params.id, user?.token]);

  if (error) return <p>{error}</p>;
  if (!doc) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <Link href="/sources" className={styles.backLink}>
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
        {doc.doc_type && <span>{t(`docType.${doc.doc_type}` as TranslationKey)}</span>}
        {doc.date && <span>{doc.date}</span>}
        {doc.identifier && <span>{doc.identifier}</span>}
        {doc.series && doc.issue_number && (
          <span>
            ΦΕΚ {doc.series} {doc.issue_number}
          </span>
        )}
        {doc.municipality && <span>{doc.municipality}</span>}
      </div>

      <div className="card">
        {doc.content ? (
          <div className={styles.content}>{doc.content}</div>
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
        <DocumentContent />
      </AppShell>
    </RequireAuth>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import type { ProjectDocumentSummary, ProjectDocumentUploadResult } from "../lib/types";
import styles from "./ProjectDocumentsPanel.module.css";

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectDocumentsPanel({
  projectId,
  token,
  hasCustomer,
}: {
  projectId: number;
  token: string | null;
  hasCustomer: boolean;
}) {
  const { t, tUpper } = useLocale();
  const [docs, setDocs] = useState<ProjectDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<"project" | "customer" | "company">("project");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Row id currently showing its inline delete-confirm checkbox (same
  // pattern as StaleDocumentsQueue: a checkbox gates the destructive
  // button, no separate modal).
  const [confirmRowId, setConfirmRowId] = useState<number | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .get<ProjectDocumentSummary[]>(`/projects/${projectId}/documents`, token)
      .then((data) => {
        if (!cancelled) setDocs(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, projectId]);

  async function handleUpload() {
    if (!token || !file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("files", file);
      formData.append("scope", scope);
      const results = await api.upload<ProjectDocumentUploadResult[]>(
        `/projects/${projectId}/documents/upload`,
        formData,
        token
      );
      const result = results[0];
      if (!result || result.error) {
        setUploadError(result?.error ?? t("project.documents.uploadFailed"));
        return;
      }
      // Company-wide uploads don't show up in this project's own list (see
      // GET /projects/{id}/documents's docstring) - they land in the
      // general KB document list instead, so skip prepending those here.
      if (scope !== "company") {
        setDocs((prev) => [
          {
            id: result.document_id!,
            title: result.filename,
            extraction_status: result.extraction_status,
            created_at: new Date().toISOString(),
            chunk_count: result.chunk_count,
            doc_scope: scope,
          },
          ...prev,
        ]);
      }
      setFile(null);
      setScope("project");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : t("project.documents.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!token) return;
    setDeletingId(id);
    try {
      await api.del(`/projects/${projectId}/documents/${id}`, token);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setConfirmRowId(null);
      setConfirmChecked(false);
    } catch {
      // Leave the row in place so the user can retry.
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className={`card ${styles.uploadCard}`}>
        <h3 className={styles.cardTitle}>{t("project.documents.uploadTitle")}</h3>
        <div className={styles.uploadRow}>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setUploadError(null);
            }}
          />
          <button type="button" className="btn btn-primary" disabled={!file || uploading} onClick={handleUpload}>
            {uploading ? t("common.loading") : t("project.documents.uploadButton")}
          </button>
        </div>
        {file && (
          <p className={styles.fileInfo}>
            {file.name} · {formatSize(file.size)}
          </p>
        )}

        <div className={styles.scopeGroup} role="radiogroup" aria-label={t("project.documents.scopeLabel")}>
          <label className={styles.scopeOption}>
            <input type="radio" name="doc-scope" checked={scope === "project"} onChange={() => setScope("project")} />
            <span>
              <strong>{t("project.documents.scopeProject")}</strong>
              <span className={styles.scopeHint}>{t("project.documents.scopeProjectHint")}</span>
            </span>
          </label>
          {hasCustomer && (
            <label className={styles.scopeOption}>
              <input type="radio" name="doc-scope" checked={scope === "customer"} onChange={() => setScope("customer")} />
              <span>
                <strong>{t("project.documents.scopeCustomer")}</strong>
                <span className={styles.scopeHint}>{t("project.documents.scopeCustomerHint")}</span>
              </span>
            </label>
          )}
          <label className={styles.scopeOption}>
            <input type="radio" name="doc-scope" checked={scope === "company"} onChange={() => setScope("company")} />
            <span>
              <strong>{t("project.documents.scopeCompany")}</strong>
              <span className={styles.scopeHint}>{t("project.documents.scopeCompanyHint")}</span>
            </span>
          </label>
        </div>

        {uploadError && <p className={styles.uploadError}>⚠ {uploadError}</p>}
      </div>

      <div className={`card ${styles.listCard}`}>
        <h3 className={styles.cardTitle}>{t("project.documents.listTitle")}</h3>
        {loading ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : docs.length === 0 ? (
          <p className="text-muted">{t("project.documents.empty")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{tUpper("project.documents.colFilename")}</th>
                <th>{tUpper("project.documents.colStatus")}</th>
                <th>{tUpper("project.documents.colDate")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.title}
                    {d.doc_scope === "customer" && (
                      <span className={styles.scopeBadge} title={t("project.documents.scopeCustomerHint")}>
                        {t("project.documents.scopeCustomer")}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${d.extraction_status === "full_text" ? "badge-success" : "badge-warning"}`}>
                      {d.extraction_status}
                    </span>
                  </td>
                  <td className="text-muted">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className={styles.actionsCell}>
                    {confirmRowId === d.id ? (
                      <div className={styles.confirmRow}>
                        <label className={styles.confirmCheckboxRow}>
                          <input
                            type="checkbox"
                            checked={confirmChecked}
                            onChange={(e) => setConfirmChecked(e.target.checked)}
                          />
                          {t("project.documents.confirmDelete")}
                        </label>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={!confirmChecked || deletingId === d.id}
                          onClick={() => handleDelete(d.id)}
                        >
                          {deletingId === d.id ? t("common.loading") : t("project.documents.deleteButton")}
                        </button>
                        <button
                          type="button"
                          className={styles.cancelLink}
                          onClick={() => {
                            setConfirmRowId(null);
                            setConfirmChecked(false);
                          }}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-secondary" onClick={() => setConfirmRowId(d.id)}>
                        {t("project.documents.deleteButton")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

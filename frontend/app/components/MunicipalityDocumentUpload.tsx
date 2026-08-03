"use client";

import { useRef, useState } from "react";

import { ApiError, NETWORK_ERROR_STATUS, api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import { WarningIcon } from "./UiIcons";
import styles from "./ProjectDocumentsPanel.module.css";

// Same request timeout as ProjectDocumentsPanel's upload - a real file
// transfer, not a short JSON body.
const UPLOAD_TIMEOUT_MS = 90_000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Municipality accounts have no project/client concept to hang document
// upload off of (see MemberDashboard's showProjectSection), but the backend
// has always allowed municipality admins AND members to upload
// (can_upload_documents in authorization.py) - there was simply no UI
// anywhere that called POST /documents/upload. This is that entry point:
// straight to the company-wide KB, the only scope tier that makes sense
// here (no project/customer tiers exist for this company type).
export default function MunicipalityDocumentUpload({
  token,
  onUploaded,
}: {
  token: string | null;
  onUploaded?: () => void;
}) {
  const { t } = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedTitle, setUploadedTitle] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    if (!token || !file) return;
    setUploading(true);
    setUploadError(null);
    setUploadedTitle(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api.upload<{ document_id: number; title: string }>(
        "/documents/upload",
        formData,
        token,
        UPLOAD_TIMEOUT_MS
      );
      setUploadedTitle(result.title);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onUploaded?.();
    } catch (err) {
      const isNetworkError = err instanceof ApiError && err.status === NETWORK_ERROR_STATUS;
      setUploadError(
        isNetworkError
          ? t("project.documents.networkError")
          : err instanceof ApiError
            ? err.message
            : t("project.documents.uploadFailed")
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={`card ${styles.uploadCard}`}>
      <h3 className={styles.cardTitle}>{t("project.documents.uploadTitle")}</h3>
      <div className={styles.uploadRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setUploadError(null);
            setUploadedTitle(null);
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
      <p className={styles.fileInfo}>{t("municipality.documents.uploadHint")}</p>
      {uploadedTitle && (
        <p className={styles.fileInfo}>{t("municipality.documents.uploadSuccess", { title: uploadedTitle })}</p>
      )}
      {uploadError && (
        <p className={styles.uploadError}>
          <WarningIcon size={13} />
          {uploadError}
        </p>
      )}
    </div>
  );
}

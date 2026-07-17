"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "../components/AppShell";
import FieldError from "../components/FieldError";
import { LanguageToggle } from "../components/LanguageToggle";
import { LegalLink } from "../components/LegalLink";
import { ThemeToggle } from "../components/ThemeToggle";
import { API_URL, ApiError, api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { useCompany } from "../lib/company";
import { useLocale } from "../lib/i18n";
import type { LegalStatusResponse, MeSummary, SubscriptionStatusResponse, UserUsageSummary } from "../lib/types";
import dashStyles from "../dashboard/dashboard.module.css";
import styles from "./account.module.css";

function passwordStrength(password: string): "weak" | "ok" | "strong" | null {
  if (!password) return null;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 2) return "weak";
  if (score <= 3) return "ok";
  return "strong";
}

function AccountContent() {
  const { user } = useAuth();
  const { company, refresh: refreshCompany } = useCompany();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [me, setMe] = useState<MeSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.get<MeSummary>("/users/me", token).then(setMe).finally(() => setLoading(false));
  }, [token]);

  if (loading || !me) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <h1>{t("account.title")}</h1>

      <SectionAccount me={me} token={token} onUpdated={setMe} />
      {user?.companyId != null && <SectionUsage token={token} companyName={company?.name ?? null} />}
      <SectionSecurity token={token} email={me.email} />
      {user?.role === "admin" && company && <SectionCompany token={token} company={company} onLogoChanged={refreshCompany} />}
      <SectionDataRights token={token} isCompanyAdmin={user?.role === "admin"} />
      <SectionLegal dpaAcceptedAt={company?.dpa_accepted_at ?? null} dpaVersion={company?.dpa_version ?? null} />
    </div>
  );
}

function SectionLegal({ dpaAcceptedAt, dpaVersion }: { dpaAcceptedAt: string | null; dpaVersion: string | null }) {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<LegalStatusResponse | null>(null);

  useEffect(() => {
    api
      .get<LegalStatusResponse>("/legal/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  return (
    <section className={`card ${dashStyles.section}`}>
      <h2>{t("account.sectionLegal")}</h2>
      <div className={styles.field} style={{ marginTop: "var(--space-2)", display: "flex", gap: "var(--space-4)" }}>
        <LegalLink slug="terms" status={status} newTab />
        <LegalLink slug="privacy" status={status} newTab />
        <LegalLink slug="dpa" status={status} newTab />
      </div>
      {dpaAcceptedAt && dpaVersion && (
        <p className="text-muted" style={{ fontSize: "0.85rem", marginTop: "var(--space-3)" }}>
          {t("account.dpaAcceptedLine", {
            version: dpaVersion,
            date: new Date(dpaAcceptedAt).toLocaleDateString(locale),
          })}
        </p>
      )}
    </section>
  );
}

function SectionDataRights({ token, isCompanyAdmin }: { token: string | null; isCompanyAdmin: boolean }) {
  const { t } = useLocale();
  const [exporting, setExporting] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    if (!token) return;
    setExporting(true);
    setError(null);
    try {
      await api.download("/account/export", token, "theke-data-export.json");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  async function requestDeletion() {
    if (!token) return;
    if (!window.confirm(t("account.deletionConfirm"))) return;
    setRequesting(true);
    setError(null);
    try {
      await api.post("/account/request-deletion", undefined, token);
      setDeletionRequested(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  }

  return (
    <section className={`card ${dashStyles.section}`}>
      <h2>{t("account.sectionDataRights")}</h2>

      <div className={styles.field} style={{ marginTop: "var(--space-2)" }}>
        <span>{t("account.exportLabel")}</span>
        <button type="button" className="btn btn-secondary" onClick={exportData} disabled={exporting}>
          {exporting ? t("account.exporting") : t("account.exportButton")}
        </button>
      </div>

      {isCompanyAdmin && (
        <div className={styles.field} style={{ marginTop: "var(--space-4)" }}>
          <span style={{ color: "var(--color-danger)" }}>{t("account.deletionLabel")}</span>
          <p className="text-muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
            {t("account.deletionHint")}
          </p>
          {deletionRequested ? (
            <p style={{ color: "var(--color-danger)", fontWeight: 600 }}>{t("account.deletionRequested")}</p>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
              onClick={requestDeletion}
              disabled={requesting}
            >
              {t("account.deletionButton")}
            </button>
          )}
        </div>
      )}

      {error && <p style={{ color: "var(--color-danger)", marginTop: "var(--space-2)" }}>{error}</p>}
    </section>
  );
}

function SectionAccount({
  me,
  token,
  onUpdated,
}: {
  me: MeSummary;
  token: string | null;
  onUpdated: (me: MeSummary) => void;
}) {
  const { t } = useLocale();
  const [firstName, setFirstName] = useState(me.first_name ?? "");
  const [lastName, setLastName] = useState(me.last_name ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      const updated = await api.patch<MeSummary>("/users/me", { first_name: firstName, last_name: lastName, phone }, token);
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`card ${dashStyles.section}`}>
      <h2>{t("account.sectionAccount")}</h2>
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          {t("account.firstName")}
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label className={styles.field}>
          {t("account.lastName")}
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
        <label className={styles.field}>
          {t("account.email")}
          <input className="input" value={me.email} disabled />
        </label>
        <label className={styles.field}>
          {t("account.phone")}
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <div className={styles.field}>
          {t("account.language")}
          <div>
            <LanguageToggle />
          </div>
        </div>
        <div className={styles.field}>
          {t("account.theme")}
          <div>
            <ThemeToggle />
          </div>
        </div>
      </div>
      <div className={styles.saveRow}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {t("account.save")}
        </button>
        {saved && <span className={styles.savedTag}>{t("account.saved")}</span>}
      </div>
    </section>
  );
}

function SectionUsage({ token, companyName }: { token: string | null; companyName: string | null }) {
  const { t } = useLocale();
  const [usage, setUsage] = useState<UserUsageSummary | null>(null);
  const [sub, setSub] = useState<SubscriptionStatusResponse | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<UserUsageSummary>("/users/me/usage", token)
      .then(setUsage)
      .catch(() => setUsage(null));
    api
      .get<SubscriptionStatusResponse>("/subscription/status", token)
      .then(setSub)
      .catch(() => setSub(null));
  }, [token]);

  if (!usage) return null;

  const trialDaysLeft =
    sub?.status === "trial" && sub.trial_ends_at ? Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <section className={`card ${dashStyles.section}`}>
      <h2>{t("account.sectionUsage")}</h2>
      <p className="text-muted" style={{ fontSize: "0.8rem", marginTop: 0 }}>
        {t("account.usagePeriodLabel")}
      </p>
      <div className={styles.fieldGrid}>
        <div className={styles.field}>
          {t("account.usageMessages")}
          <strong>{usage.messages_30d}</strong>
        </div>
        <div className={styles.field}>
          {t("account.usageTokens")}
          <strong>{usage.total_tokens_30d.toLocaleString()}</strong>
        </div>
        <div className={styles.field}>
          {t("account.usageCost")}
          <strong>€{usage.estimated_cost_eur_30d.toFixed(2)}</strong>
        </div>
        {sub && (
          <div className={styles.field}>
            {t("account.usagePlan")}
            <strong>{sub.plan_name}</strong>
          </div>
        )}
        {sub && (
          <div className={styles.field}>
            {t("account.usageCompanyPool")}
            <strong>
              {sub.is_beta ? t("account.usageCompanyPoolUnlimited") : `${sub.messages_used}/${sub.messages_limit}`}
            </strong>
          </div>
        )}
      </div>
      {trialDaysLeft != null && (
        <p
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            marginTop: "var(--space-3)",
            color: trialDaysLeft <= 3 ? "var(--color-danger)" : trialDaysLeft <= 14 ? "var(--color-warning)" : undefined,
          }}
        >
          {t("account.usageTrialCountdown", { days: trialDaysLeft })}
        </p>
      )}
      {companyName && (
        <p className="text-muted" style={{ fontSize: "0.8rem", marginTop: "var(--space-3)" }}>
          {t("account.usageManagedBy", { company: companyName })}
        </p>
      )}
    </section>
  );
}

function SectionSecurity({ token, email }: { token: string | null; email: string }) {
  const { t } = useLocale();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});

  const strength = passwordStrength(newPassword);
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!currentPassword) errors.current = t("validation.passwordRequired");
    if (!newPassword) errors.next = t("validation.passwordRequired");
    else if (newPassword.length < 8) errors.next = t("validation.passwordTooShort");
    if (!confirmPassword) errors.confirm = t("validation.passwordRequired");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError(t("account.passwordMismatch"));
      return;
    }
    if (!token) return;
    setSubmitting(true);
    try {
      await api.post("/auth/change-password", { current_password: currentPassword, new_password: newPassword }, token);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendForgotLink() {
    await api.post("/auth/forgot-password", { email });
    setForgotSent(true);
  }

  return (
    <section className={`card ${dashStyles.section}`}>
      <h2>{t("account.sectionSecurity")}</h2>
      <form onSubmit={submit} className={styles.fieldGrid} noValidate>
        {error && <p style={{ color: "var(--color-danger)", gridColumn: "1 / -1" }}>{error}</p>}
        {success && <p style={{ color: "var(--color-success)", gridColumn: "1 / -1" }}>{t("account.passwordChanged")}</p>}
        <label className={styles.field}>
          {t("account.currentPassword")}
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              if (e.target.value) setFieldErrors((prev) => ({ ...prev, current: undefined }));
            }}
            aria-invalid={!!fieldErrors.current}
          />
          {fieldErrors.current && <FieldError message={fieldErrors.current} />}
        </label>
        <label className={styles.field}>
          {t("account.newPassword")}
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (e.target.value.length >= 8) setFieldErrors((prev) => ({ ...prev, next: undefined }));
            }}
            aria-invalid={!!fieldErrors.next}
          />
          {fieldErrors.next && <FieldError message={fieldErrors.next} />}
          {strength && (
            <span className={`${styles.strengthTag} ${styles[`strength_${strength}`]}`}>
              {t(`account.passwordStrength${strength === "weak" ? "Weak" : strength === "ok" ? "Ok" : "Strong"}` as never)}
            </span>
          )}
        </label>
        <label className={styles.field}>
          {t("account.confirmPassword")}
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (e.target.value) setFieldErrors((prev) => ({ ...prev, confirm: undefined }));
            }}
            aria-invalid={!!fieldErrors.confirm}
          />
          {fieldErrors.confirm && <FieldError message={fieldErrors.confirm} />}
          {mismatch && <span className={styles.strengthTag + " " + styles.strength_weak}>{t("account.passwordMismatch")}</span>}
        </label>
      </form>
      <div className={styles.saveRow}>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting || mismatch}>
          {t("account.changePassword")}
        </button>
      </div>

      <p className={styles.forgotLink}>
        {forgotSent ? (
          t("account.forgotSent", { email })
        ) : (
          <button type="button" className={styles.linkButton} onClick={sendForgotLink}>
            {t("account.forgotLink", { email })}
          </button>
        )}
      </p>
    </section>
  );
}

function SectionCompany({
  token,
  company,
  onLogoChanged,
}: {
  token: string | null;
  company: {
    id: number;
    name: string;
    has_logo: boolean;
    logo_url: string | null;
    legal_name: string | null;
    afm: string | null;
    billing_address: string | null;
  };
  onLogoChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [legalName, setLegalName] = useState(company.legal_name ?? "");
  const [afm, setAfm] = useState(company.afm ?? "");
  const [billingAddress, setBillingAddress] = useState(company.billing_address ?? "");
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingSaved, setBillingSaved] = useState(false);

  async function saveBillingDetails() {
    if (!token) return;
    setBillingSaving(true);
    try {
      await api.patch(
        "/companies/me/billing-details",
        { legal_name: legalName, afm, billing_address: billingAddress },
        token
      );
      await onLogoChanged(); // also refreshes company (see AccountContent's refreshCompany)
      setBillingSaved(true);
      setTimeout(() => setBillingSaved(false), 2000);
    } finally {
      setBillingSaving(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError(t("account.logoTooLarge"));
      return;
    }
    setPendingFile(file);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function saveLogo() {
    if (!token || !pendingFile) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      await api.upload("/companies/me/logo", formData, token);
      setPendingFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await onLogoChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeLogo() {
    if (!token) return;
    await api.del("/companies/me/logo", token);
    await onLogoChanged();
  }

  const displayedLogo = preview ?? (company.has_logo && company.logo_url ? `${API_URL}${company.logo_url}` : null);

  return (
    <section className={`card ${dashStyles.section}`}>
      <h2>{t("account.sectionCompany")}</h2>
      <label className={styles.field}>
        {t("account.companyName")}
        <input className="input" value={company.name} disabled />
      </label>

      <div className={styles.logoSection}>
        <h3>{t("account.logo")}</h3>
        {displayedLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayedLogo} alt={company.name} className={styles.logoPreview} />
        ) : (
          <p className="text-muted">{t("account.logoNotSet")}</p>
        )}

        {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

        <div className={styles.logoControls}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={handleFileSelect}
          />
          {pendingFile && (
            <button type="button" className="btn btn-primary" onClick={saveLogo} disabled={saving}>
              {t("account.logoSave")}
            </button>
          )}
          {company.has_logo && !pendingFile && (
            <button type="button" className="btn btn-secondary" onClick={removeLogo}>
              {t("account.logoRemove")}
            </button>
          )}
        </div>
        <p className={styles.formatNote}>{t("account.logoFormatNote")}</p>
      </div>

      <div className={styles.logoSection}>
        <h3>{t("account.billingDetailsHeading")}</h3>
        <p className="text-muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          {t("account.billingDetailsHint")}
        </p>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            {t("account.billingLegalName")}
            <input className="input" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </label>
          <label className={styles.field}>
            {t("account.billingAfm")}
            <input className="input" value={afm} onChange={(e) => setAfm(e.target.value)} maxLength={9} />
          </label>
          <label className={styles.field}>
            {t("account.billingAddress")}
            <input className="input" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
          </label>
        </div>
        <div className={styles.saveRow}>
          <button type="button" className="btn btn-primary" onClick={saveBillingDetails} disabled={billingSaving}>
            {t("account.save")}
          </button>
          {billingSaved && <span className={styles.savedTag}>{t("account.saved")}</span>}
        </div>
      </div>
    </section>
  );
}

export default function AccountPage() {
  return (
    <RequireAuth>
      <AppShell>
        <AccountContent />
      </AppShell>
    </RequireAuth>
  );
}

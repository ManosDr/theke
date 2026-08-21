"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import FieldError from "../components/FieldError";
import { LanguageToggle } from "../components/LanguageToggle";
import { LegalFooter } from "../components/LegalFooter";
import { LegalLink } from "../components/LegalLink";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { LegalStatusResponse } from "../lib/types";
import styles from "../login/login.module.css";

interface TokenResponse {
  token: string;
  company_id: number | null;
  company_type: "construction" | "municipality" | null;
  role: string;
}

interface InviteInfo {
  company_name: string | null;
  vertical_display_name: string;
  role: string;
  requires_company_name?: boolean;
  email: string;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const { t, locale } = useLocale();

  // Set only when arriving via the public pricing page's CTA
  // (?intended_tier=<plan slug>) - passed through to registration so the
  // backend can log it for manual sales reference (see auth.py's
  // register() - there's no company record yet at this point to store it
  // on directly). Read once on mount; the pricing page's own CTA is the
  // only place this URL shape is ever produced.
  const intendedTier = searchParams.get("intended_tier");

  const [mode, setMode] = useState<"invite" | "new_company">("new_company");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [inviteInfoError, setInviteInfoError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<"construction" | "municipality" | "accounting">("construction");
  // Only used when accepting a company-less invite (inviteInfo.requires_company_name)
  // - collected here, in the same step, but uploaded via the existing
  // POST /companies/me/logo endpoint right after registration succeeds,
  // since that endpoint requires an authenticated company that doesn't
  // exist until this very form submits.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Optional "how did you hear about us" - only meaningful when this
  // registration is creating a brand new company (either mode, since a
  // company-less invite's requires_company_name branch also creates one).
  // Never validated/required - see Company.acquisition_source.
  const [acquisitionSource, setAcquisitionSource] = useState("");
  const [dpaAccepted, setDpaAccepted] = useState(false);
  const [legalStatus, setLegalStatus] = useState<LegalStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    inviteToken?: string;
    companyName?: string;
    dpaAccepted?: string;
  }>({});

  // Tracks the mode-dependent block's real height so .modeContent can
  // transition to it instead of the form abruptly jumping when switching
  // between the invite (3 fields) and new-company (4 fields) layouts.
  //
  // A ResizeObserver-based version of this used to live here, but it never
  // produced a visible transition: ResizeObserver delivers its callback
  // before paint, in the same frame the DOM changed, so the browser had no
  // "old height" frame to actually paint before jumping to the new one -
  // there was nothing for the CSS transition to interpolate between. This
  // is the standard FLIP fix instead: lock the wrapper to its current
  // (pre-switch) height synchronously in the tab click handler below, let
  // React commit the mode switch against that still-locked height, then
  // measure the new content's natural height here and apply it a frame
  // later via requestAnimationFrame - guaranteeing two distinct painted
  // frames for the transition to animate between.
  const modeWrapperRef = useRef<HTMLDivElement>(null);
  const modeContentRef = useRef<HTMLDivElement>(null);
  const [modeContentHeight, setModeContentHeight] = useState<number | undefined>(undefined);
  const modeMounted = useRef(false);

  function lockModeContentHeight() {
    const wrapper = modeWrapperRef.current;
    if (!wrapper) return;
    setModeContentHeight(wrapper.getBoundingClientRect().height);
  }

  useEffect(() => {
    const content = modeContentRef.current;
    if (!content) return;

    if (!modeMounted.current) {
      modeMounted.current = true;
      setModeContentHeight(content.scrollHeight);
      return;
    }

    const nextHeight = content.scrollHeight;
    const frame = requestAnimationFrame(() => setModeContentHeight(nextHeight));
    return () => cancelAnimationFrame(frame);
    // requires_company_name arrives asynchronously (after the debounced
    // GET /auth/invite-info call resolves), well after the mode switch
    // itself - re-measuring only on [mode] would lock the wrapper's height
    // before the company-name/logo fields exist, so the invite step
    // silently overflows below the animated container.
  }, [mode, inviteInfo?.requires_company_name]);

  useEffect(() => {
    api
      .get<LegalStatusResponse>("/legal/status")
      .then(setLegalStatus)
      .catch(() => setLegalStatus(null));
  }, []);

  // Prefills the invite code from the invite email's "Αποδοχή πρόσκλησης"
  // button (?invite_token=...) so clicking it actually lands the invitee
  // in a ready-to-submit form, rather than a blank one they'd have to
  // paste the code into by hand. Read once on mount, same as intendedTier
  // above.
  useEffect(() => {
    const tokenFromUrl = searchParams.get("invite_token");
    if (tokenFromUrl) {
      setMode("invite");
      setInviteToken(tokenFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Looks up the invite's company/vertical as soon as a plausible token is
  // typed/pasted, so the invitee sees what they're joining before
  // submitting - GET /auth/invite-info/{token} exists on the backend
  // specifically for this (see its docstring) but was never wired up here.
  useEffect(() => {
    if (mode !== "invite" || inviteToken.trim().length < 10) {
      setInviteInfo(null);
      setInviteInfoError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<InviteInfo>(`/auth/invite-info/${encodeURIComponent(inviteToken.trim())}`)
        .then((info) => {
          if (!cancelled) {
            setInviteInfo(info);
            setInviteInfoError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setInviteInfo(null);
            setInviteInfoError(err instanceof ApiError ? err.message : t("register.invalidInvite"));
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, inviteToken, t]);

  // The invite already knows exactly who it was sent to (auth.py's
  // register() 403s if the submitted email doesn't match Invite.email
  // anyway) - pre-filling and locking the field means an invitee can't
  // accidentally register under a different address and hit that error,
  // and can't be tricked into typing a different one on a shared screen.
  // Self-serve (new_company) registration is untouched - this only runs
  // once a real invite has resolved.
  useEffect(() => {
    if (mode === "invite" && inviteInfo) {
      setEmail(inviteInfo.email);
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
  }, [mode, inviteInfo]);

  const emailLockedByInvite = mode === "invite" && !!inviteInfo;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = t("validation.emailRequired");
    if (!password) errors.password = t("validation.passwordRequired");
    else if (password.length < 8) errors.password = t("validation.passwordTooShort");
    if (!firstName.trim()) errors.firstName = t("validation.fieldRequired");
    if (!lastName.trim()) errors.lastName = t("validation.fieldRequired");
    if (mode === "invite" && !inviteToken.trim()) errors.inviteToken = t("validation.fieldRequired");
    // Company name is optional on both new-company paths - left blank, the
    // backend defaults the company's display name to the founding admin's
    // own name (first + last) rather than forcing a placeholder value like
    // "." into a real field (see KNOWN_DECISIONS.md).
    if (!dpaAccepted) errors.dpaAccepted = t("register.dpaRequired");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setError(null);
    setLoading(true);
    try {
      const registerResponse = await api.post<TokenResponse>("/auth/register", {
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        preferred_locale: locale,
        dpa_accepted: dpaAccepted,
        // Construction firm and municipality both consume the "construction"
        // vertical's content - there is no separate "municipality" vertical
        // (see verticals table: only "construction" and "tax_accounting"
        // exist). Accounting firms map to "tax_accounting" - added in Phase 4
        // alongside the "Λογιστικό γραφείο" option below (previously the
        // only company types offered here were construction/municipality,
        // so self-serve accounting-firm signup wasn't reachable through the
        // UI at all - see KNOWN_DECISIONS.md). vertical_slug is required by
        // the backend on this path and has no default - omitting it 422'd
        // every new-company registration regardless of companyType, until
        // that was caught live during Section 8.5 verification.
        ...(mode === "invite"
          ? {
              invite_token: inviteToken,
              // Only meaningful (and only required server-side) for a
              // company-less invite - ignored by the backend otherwise.
              ...(inviteInfo?.requires_company_name
                ? { new_company_name: companyName.trim() || undefined, acquisition_source: acquisitionSource.trim() || undefined }
                : {}),
            }
          : {
              intended_tier: intendedTier || undefined,
              company_name: companyName.trim() || undefined,
              company_type: companyType,
              vertical_slug: companyType === "accounting" ? "tax_accounting" : "construction",
              acquisition_source: acquisitionSource.trim() || undefined,
            }),
      });

      // Uploads the optional logo picked in the same step, using the fresh
      // token straight from the register response - reuses the existing
      // company-logo endpoint rather than a second upload path, and avoids
      // any dependency on auth-context state having settled yet.
      if (mode === "invite" && inviteInfo?.requires_company_name && logoFile) {
        const formData = new FormData();
        formData.append("file", logoFile);
        try {
          await api.upload("/companies/me/logo", formData, registerResponse.token);
        } catch {
          // A failed logo upload shouldn't block account creation - the
          // admin can add/retry a logo later from the Account page, which
          // uses this exact same endpoint.
        }
      }

      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.errorFallback"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <h1 className="sr-only">theke: {t("register.createAccount")}</h1>
      <div className={styles.themeToggle} style={{ display: "flex", gap: "var(--space-2)" }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className={styles.intro}>
        {/* Not styled as a nav element on purpose - a logo that happens to
            be a link back to the public landing page, not a button/tab.
            Inline color/textDecoration reset beats globals.css's a/a:hover
            rules at any specificity, so the wordmark keeps its normal text
            color instead of turning link-blue. */}
        <Link href="/" style={{ display: "inline-flex", color: "inherit", textDecoration: "none" }}>
          <Logo height="2.5rem" />
        </Link>
      </div>

      <form className={`card ${styles.card}`} onSubmit={handleSubmit} noValidate>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.modeTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "new_company"}
            className={`${styles.modeTab} ${mode === "new_company" ? styles.modeTabActive : ""}`}
            onClick={() => {
              lockModeContentHeight();
              setMode("new_company");
            }}
          >
            {t("register.createCompany")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "invite"}
            className={`${styles.modeTab} ${mode === "invite" ? styles.modeTabActive : ""}`}
            onClick={() => {
              lockModeContentHeight();
              setMode("invite");
            }}
          >
            {t("register.haveInvite")}
          </button>
        </div>

        <div className={styles.field}>
          <label htmlFor="email">{t("login.email")}</label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => {
              if (emailLockedByInvite) return;
              setEmail(e.target.value);
              if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            readOnly={emailLockedByInvite}
            aria-readonly={emailLockedByInvite}
            aria-invalid={!!fieldErrors.email}
            autoComplete="email"
          />
          {emailLockedByInvite && (
            <p className={styles.footerLink} style={{ marginTop: "var(--space-2)" }}>
              {t("register.emailLockedByInvite")}
            </p>
          )}
          {fieldErrors.email && <FieldError message={fieldErrors.email} />}
        </div>

        <div className={styles.field}>
          <label htmlFor="password">{t("login.password")}</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (e.target.value.length >= 8) setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
            aria-invalid={!!fieldErrors.password}
            autoComplete="new-password"
          />
          {fieldErrors.password && <FieldError message={fieldErrors.password} />}
        </div>

        <div className={styles.field}>
          <label htmlFor="firstName">{t("register.firstName")}</label>
          <input
            id="firstName"
            type="text"
            className="input"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, firstName: undefined }));
            }}
            aria-invalid={!!fieldErrors.firstName}
            autoComplete="given-name"
          />
          {fieldErrors.firstName && <FieldError message={fieldErrors.firstName} />}
        </div>

        <div className={styles.field}>
          <label htmlFor="lastName">{t("register.lastName")}</label>
          <input
            id="lastName"
            type="text"
            className="input"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, lastName: undefined }));
            }}
            aria-invalid={!!fieldErrors.lastName}
            autoComplete="family-name"
          />
          {fieldErrors.lastName && <FieldError message={fieldErrors.lastName} />}
        </div>

        <div ref={modeWrapperRef} className={styles.modeContent} style={{ height: modeContentHeight }}>
          <div ref={modeContentRef} className={styles.modeContentInner}>
            {mode === "invite" ? (
              <div className={styles.field}>
                <label htmlFor="inviteToken">{t("register.inviteCode")}</label>
                <input
                  id="inviteToken"
                  type="text"
                  className="input"
                  value={inviteToken}
                  onChange={(e) => {
                    setInviteToken(e.target.value);
                    if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, inviteToken: undefined }));
                  }}
                  aria-invalid={!!fieldErrors.inviteToken}
                />
                {fieldErrors.inviteToken && <FieldError message={fieldErrors.inviteToken} />}
                {inviteInfo && !inviteInfo.requires_company_name && (
                  <p className={styles.footerLink} style={{ marginTop: "var(--space-2)" }}>
                    {t("register.joiningCompany")} <strong>{inviteInfo.company_name}</strong> ·{" "}
                    {inviteInfo.vertical_display_name}
                  </p>
                )}
                {inviteInfo?.requires_company_name && (
                  <>
                    <p className={styles.footerLink} style={{ marginTop: "var(--space-2)" }}>
                      {t("register.joiningVertical")} <strong>{inviteInfo.vertical_display_name}</strong>
                    </p>
                    <div className={styles.field} style={{ marginTop: "var(--space-3)" }}>
                      <label htmlFor="newCompanyName">{t("register.yourCompanyName")}</label>
                      <input
                        id="newCompanyName"
                        type="text"
                        className="input"
                        value={companyName}
                        placeholder={t("register.yourCompanyNamePlaceholder")}
                        onChange={(e) => {
                          setCompanyName(e.target.value);
                          if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, companyName: undefined }));
                        }}
                        aria-invalid={!!fieldErrors.companyName}
                      />
                      {fieldErrors.companyName && <FieldError message={fieldErrors.companyName} />}
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="newCompanyLogo">{t("register.logoOptional")}</label>
                      <input
                        id="newCompanyLogo"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="acquisitionSourceInvite">{t("register.acquisitionSource")}</label>
                      <input
                        id="acquisitionSourceInvite"
                        type="text"
                        className="input"
                        value={acquisitionSource}
                        placeholder={t("register.acquisitionSourcePlaceholder")}
                        onChange={(e) => setAcquisitionSource(e.target.value)}
                      />
                    </div>
                  </>
                )}
                {inviteInfoError && <p className={styles.error}>{inviteInfoError}</p>}
              </div>
            ) : (
              <>
                <div className={styles.field}>
                  <label htmlFor="companyName">{t("register.companyName")}</label>
                  <input
                    id="companyName"
                    type="text"
                    className="input"
                    value={companyName}
                    onChange={(e) => {
                      setCompanyName(e.target.value);
                      if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, companyName: undefined }));
                    }}
                    aria-invalid={!!fieldErrors.companyName}
                  />
                  {fieldErrors.companyName && <FieldError message={fieldErrors.companyName} />}
                </div>
                <div className={styles.field}>
                  <label htmlFor="companyType">{t("register.accountType")}</label>
                  <select
                    id="companyType"
                    className="input"
                    value={companyType}
                    onChange={(e) => setCompanyType(e.target.value as "construction" | "municipality" | "accounting")}
                  >
                    <option value="construction">{t("register.typeConstruction")}</option>
                    <option value="municipality">{t("register.typeMunicipality")}</option>
                    <option value="accounting">{t("register.typeAccounting")}</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="acquisitionSource">{t("register.acquisitionSource")}</label>
                  <input
                    id="acquisitionSource"
                    type="text"
                    className="input"
                    value={acquisitionSource}
                    placeholder={t("register.acquisitionSourcePlaceholder")}
                    onChange={(e) => setAcquisitionSource(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.field}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={dpaAccepted}
              onChange={(e) => {
                setDpaAccepted(e.target.checked);
                if (e.target.checked) setFieldErrors((prev) => ({ ...prev, dpaAccepted: undefined }));
              }}
              aria-invalid={!!fieldErrors.dpaAccepted}
            />
            <span>
              {t("register.dpaCheckboxPrefix")}
              <LegalLink slug="terms" status={legalStatus} newTab label={t("register.termsAccusative")} />
              {t("register.dpaCheckboxMiddle")}
              <LegalLink slug="dpa" status={legalStatus} newTab label={t("register.dpaAccusative")} />
              {t("register.dpaCheckboxSuffix")}
            </span>
          </label>
          {fieldErrors.dpaAccepted && <FieldError message={fieldErrors.dpaAccepted} />}
          <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", margin: "var(--space-2) 0 0" }}>
            {t("register.privacyInfoPrefix")}
            <LegalLink slug="privacy" status={legalStatus} newTab />
            {t("register.dpaCheckboxSuffix")}
          </p>
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? t("register.creatingAccount") : t("register.createAccount")}
        </button>

        <p className={styles.footerLink}>
          {t("register.alreadyHaveAccount")} <a href="/login">{t("register.signIn")}</a>
        </p>
      </form>
      <LegalFooter />
    </main>
  );
}

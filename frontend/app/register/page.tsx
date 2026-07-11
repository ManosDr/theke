"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import FieldError from "../components/FieldError";
import { Logo } from "../components/Logo";
import { LanguageToggle } from "../components/LanguageToggle";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import styles from "../login/login.module.css";

interface TokenResponse {
  token: string;
  company_id: number | null;
  company_type: "construction" | "municipality" | null;
  role: string;
}

interface InviteInfo {
  company_name: string;
  vertical_display_name: string;
  role: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t, locale } = useLocale();

  const [mode, setMode] = useState<"invite" | "new_company">("new_company");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [inviteInfoError, setInviteInfoError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<"construction" | "municipality" | "accounting">("construction");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    inviteToken?: string;
    companyName?: string;
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
  }, [mode]);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = t("validation.emailRequired");
    if (!password) errors.password = t("validation.passwordRequired");
    else if (password.length < 8) errors.password = t("validation.passwordTooShort");
    if (mode === "invite" && !inviteToken.trim()) errors.inviteToken = t("validation.fieldRequired");
    if (mode === "new_company" && !companyName.trim()) errors.companyName = t("validation.fieldRequired");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setError(null);
    setLoading(true);
    try {
      await api.post<TokenResponse>("/auth/register", {
        email,
        password,
        preferred_locale: locale,
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
          ? { invite_token: inviteToken }
          : {
              company_name: companyName,
              company_type: companyType,
              vertical_slug: companyType === "accounting" ? "tax_accounting" : "construction",
            }),
      });
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
      <h1 className="sr-only">theke — {t("register.createAccount")}</h1>
      <div className={styles.themeToggle} style={{ display: "flex", gap: "var(--space-2)" }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className={styles.intro}>
        <Logo size={56} />
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
              setEmail(e.target.value);
              if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            aria-invalid={!!fieldErrors.email}
            autoComplete="email"
          />
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
                {inviteInfo && (
                  <p className={styles.footerLink} style={{ marginTop: "var(--space-2)" }}>
                    {t("register.joiningCompany")} <strong>{inviteInfo.company_name}</strong> ·{" "}
                    {inviteInfo.vertical_display_name}
                  </p>
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
              </>
            )}
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? t("register.creatingAccount") : t("register.createAccount")}
        </button>

        <p className={styles.footerLink}>
          {t("register.alreadyHaveAccount")} <a href="/login">{t("register.signIn")}</a>
        </p>
      </form>
    </main>
  );
}

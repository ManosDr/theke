"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
      <div className={styles.themeToggle} style={{ display: "flex", gap: "var(--space-2)" }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className={styles.intro}>
        <Logo size={56} />
      </div>

      <form className={`card ${styles.card}`} onSubmit={handleSubmit}>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.demoGrid} role="tablist">
          <button
            type="button"
            className={`btn ${mode === "new_company" ? "btn-primary" : "btn-secondary"} ${styles.fullRow}`}
            onClick={() => setMode("new_company")}
          >
            {t("register.createCompany")}
          </button>
          <button
            type="button"
            className={`btn ${mode === "invite" ? "btn-primary" : "btn-secondary"} ${styles.fullRow}`}
            onClick={() => setMode("invite")}
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
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="password">{t("login.password")}</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        {mode === "invite" ? (
          <div className={styles.field}>
            <label htmlFor="inviteToken">{t("register.inviteCode")}</label>
            <input
              id="inviteToken"
              type="text"
              className="input"
              value={inviteToken}
              onChange={(e) => setInviteToken(e.target.value)}
              required
            />
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
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
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

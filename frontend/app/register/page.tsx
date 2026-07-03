"use client";

import { useState } from "react";
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

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t, locale } = useLocale();

  const [mode, setMode] = useState<"invite" | "new_company">("new_company");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<"construction" | "municipality">("construction");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post<TokenResponse>("/auth/register", {
        email,
        password,
        preferred_locale: locale,
        ...(mode === "invite" ? { invite_token: inviteToken } : { company_name: companyName, company_type: companyType }),
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
                onChange={(e) => setCompanyType(e.target.value as "construction" | "municipality")}
              >
                <option value="construction">{t("register.typeConstruction")}</option>
                <option value="municipality">{t("register.typeMunicipality")}</option>
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

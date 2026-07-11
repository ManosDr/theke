"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import FieldError from "../components/FieldError";
import { Logo } from "../components/Logo";
import { LanguageToggle } from "../components/LanguageToggle";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import styles from "./login.module.css";

const DEMO_PASSWORD = "demo1234";

const DEMO_ACCOUNTS: { labelKey: TranslationKey; email: string }[] = [
  { labelKey: "login.demo.superAdmin", email: "demo-superadmin@theke.gr" },
  { labelKey: "login.demo.constructionAdmin", email: "demo-admin@construction.theke.gr" },
  { labelKey: "login.demo.constructionMember", email: "demo-member@construction.theke.gr" },
  { labelKey: "login.demo.municipalityAdmin", email: "demo-admin@municipality.theke.gr" },
  { labelKey: "login.demo.municipalityMember", email: "demo-member@municipality.theke.gr" },
  { labelKey: "login.demo.accountingAdmin", email: "demo-admin@accounting.theke.gr" },
  { labelKey: "login.demo.accountingMember", email: "demo-member@accounting.theke.gr" },
];

function LoginContent() {
  const { login } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [demoEmail, setDemoEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A boolean, not the translated string itself - t() is called at render
  // time below so the message stays correct if the user switches language
  // after landing here (a saved string would freeze at whatever locale was
  // active the instant this effect ran, which can be wrong: the redirect
  // is a full page reload, and LocaleProvider's own locale-from-storage
  // effect isn't guaranteed to resolve before this one does).
  const [sessionExpired, setSessionExpired] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    if (searchParams.get("sessionExpired")) {
      setSessionExpired(true);
    }
  }, [searchParams]);

  async function doLogin(loginEmail: string, loginPassword: string) {
    setError(null);
    setSessionExpired(false);
    setLoading(true);
    try {
      await login(loginEmail, loginPassword);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.errorFallback"));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = t("validation.emailRequired");
    if (!password) errors.password = t("validation.passwordRequired");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    doLogin(email, password);
  }

  function handleDemoSignIn() {
    if (!demoEmail) return;
    doLogin(demoEmail, DEMO_PASSWORD);
  }

  return (
    <main className={styles.page}>
      <div className={styles.themeToggle} style={{ display: "flex", gap: "var(--space-2)" }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className={styles.intro}>
        <Logo size={56} />
        <p className={styles.tagline}>{t("login.tagline")}</p>
      </div>

      <form className={`card ${styles.card}`} onSubmit={handleSubmit} noValidate>
        {sessionExpired && <p className={styles.error}>{t("login.sessionExpired")}</p>}
        {error && <p className={styles.error}>{error}</p>}

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
              if (e.target.value) setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
            aria-invalid={!!fieldErrors.password}
            autoComplete="current-password"
          />
          {fieldErrors.password && <FieldError message={fieldErrors.password} />}
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? t("login.signingIn") : t("login.signIn")}
        </button>

        <p className={styles.footerLink}>
          <a href="/forgot-password">{t("login.forgotPassword")}</a>
        </p>

        <div className={styles.divider}>{t("login.orDemo")}</div>

        <div className={styles.demoRow}>
          <select
            className="input"
            value={demoEmail}
            onChange={(e) => setDemoEmail(e.target.value)}
            aria-label={t("login.demo.selectPlaceholder")}
          >
            <option value="">{t("login.demo.selectPlaceholder")}</option>
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.email} value={account.email}>
                {t(account.labelKey)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || !demoEmail}
            onClick={handleDemoSignIn}
          >
            {t("login.demo.signIn")}
          </button>
        </div>

        <p className={styles.footerLink}>
          {t("login.newHere")} <a href="/register">{t("login.createAccount")}</a>
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

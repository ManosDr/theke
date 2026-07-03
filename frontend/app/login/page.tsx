"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
];

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useLocale();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function doLogin(loginEmail: string, loginPassword: string) {
    setError(null);
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
    doLogin(email, password);
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

      <form className={`card ${styles.card}`} onSubmit={handleSubmit}>
        {error && <p className={styles.error}>{error}</p>}

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
            autoComplete="current-password"
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? t("login.signingIn") : t("login.signIn")}
        </button>

        <div className={styles.divider}>{t("login.orDemo")}</div>

        <div className={styles.demoGrid}>
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => doLogin(account.email, DEMO_PASSWORD)}
            >
              {t(account.labelKey)}
            </button>
          ))}
        </div>

        <p className={styles.footerLink}>
          {t("login.newHere")} <a href="/register">{t("login.createAccount")}</a>
        </p>
      </form>
    </main>
  );
}

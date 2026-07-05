"use client";

import { useState } from "react";

import { Logo } from "../components/Logo";
import { LanguageToggle } from "../components/LanguageToggle";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError, api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import styles from "../login/login.module.css";

export default function ForgotPasswordPage() {
  const { t } = useLocale();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
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
        <h1 style={{ fontSize: "1.1rem", margin: 0 }}>{t("forgotPassword.title")}</h1>
        {error && <p className={styles.error}>{error}</p>}

        {sent ? (
          <p>{t("forgotPassword.success")}</p>
        ) : (
          <>
            <p className="text-muted" style={{ fontSize: "0.9rem" }}>
              {t("forgotPassword.instructions")}
            </p>
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
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t("forgotPassword.sending") : t("forgotPassword.submit")}
            </button>
          </>
        )}

        <p className={styles.footerLink}>
          <a href="/login">{t("forgotPassword.backToLogin")}</a>
        </p>
      </form>
    </main>
  );
}

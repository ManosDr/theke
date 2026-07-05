"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Logo } from "../components/Logo";
import { LanguageToggle } from "../components/LanguageToggle";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError, api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import styles from "../login/login.module.css";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLocale();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.errorFallback"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={`card ${styles.card}`} onSubmit={handleSubmit}>
      <h1 style={{ fontSize: "1.1rem", margin: 0 }}>{t("resetPassword.title")}</h1>

      {!token ? (
        <p className={styles.error}>{t("resetPassword.invalidToken")}</p>
      ) : done ? (
        <>
          <p>{t("resetPassword.success")}</p>
          <button type="button" className="btn btn-primary" onClick={() => router.push("/login")}>
            {t("resetPassword.signIn")}
          </button>
        </>
      ) : (
        <>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.field}>
            <label htmlFor="password">{t("resetPassword.newPassword")}</label>
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
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? t("resetPassword.submitting") : t("resetPassword.submit")}
          </button>
        </>
      )}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className={styles.page}>
      <div className={styles.themeToggle} style={{ display: "flex", gap: "var(--space-2)" }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className={styles.intro}>
        <Logo size={56} />
      </div>

      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { LanguageToggle } from "../components/LanguageToggle";
import { LegalFooter } from "../components/LegalFooter";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import styles from "../login/login.module.css";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLocale();
  const { user, markEmailVerified } = useAuth();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  // Effects run twice under React Strict Mode in dev - the token is
  // single-use server-side, so a duplicate call would otherwise surface a
  // spurious "invalid or expired" error on the second run.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    api
      .post("/auth/verify-email", { token })
      .then(() => {
        setStatus("success");
        // Only meaningful if the browser verifying the link happens to
        // still be logged in as that same account (often it isn't - the
        // link is commonly opened from a different device/tab) - markEmailVerified
        // is a no-op when there's no active session.
        if (user) markEmailVerified();
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof ApiError ? err.message : t("login.errorFallback"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className={`card ${styles.card}`}>
      <h1 style={{ fontSize: "1.1rem", margin: 0 }}>{t("verifyEmail.title")}</h1>

      {!token ? (
        <p className={styles.error}>{t("verifyEmail.invalidToken")}</p>
      ) : status === "pending" ? (
        <p className="text-muted">{t("verifyEmail.pending")}</p>
      ) : status === "success" ? (
        <>
          <p>{t("verifyEmail.success")}</p>
          <button type="button" className="btn btn-primary" onClick={() => router.push(user ? "/chat" : "/login")}>
            {user ? t("verifyEmail.continueToChat") : t("verifyEmail.signIn")}
          </button>
        </>
      ) : (
        <p className={styles.error}>{error}</p>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className={styles.page}>
      <div className={styles.themeToggle} style={{ display: "flex", gap: "var(--space-2)" }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className={styles.intro}>
        <Logo height="1.856rem" />
      </div>

      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <VerifyEmailContent />
      </Suspense>
      <LegalFooter />
    </main>
  );
}

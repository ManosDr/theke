"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import styles from "./login.module.css";

const DEMO_PASSWORD = "demo1234";

const DEMO_ACCOUNTS = [
  { label: "Super Admin", email: "demo-superadmin@theke.gr" },
  { label: "Construction Admin", email: "demo-admin@construction.theke.gr" },
  { label: "Construction Member", email: "demo-member@construction.theke.gr" },
  { label: "Municipality Admin", email: "demo-admin@municipality.theke.gr" },
  { label: "Municipality Member", email: "demo-member@municipality.theke.gr" },
];

export default function LoginPage() {
  const { login } = useAuth();
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
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Is it running?");
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
      <div className={styles.themeToggle}>
        <ThemeToggle />
      </div>

      <div className={styles.intro}>
        <Logo size={56} />
        <p className={styles.tagline}>
          Your AI copilot for Greek construction permits &amp; compliance — instant answers with citations from
          ΦΕΚ, ΤΕΕ, ΥΠΕΝ, and your own knowledge base.
        </p>
      </div>

      <form className={`card ${styles.card}`} onSubmit={handleSubmit}>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label htmlFor="email">Email</label>
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
          <label htmlFor="password">Password</label>
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
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <div className={styles.divider}>or try a demo account</div>

        <div className={styles.demoGrid}>
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => doLogin(account.email, DEMO_PASSWORD)}
            >
              {account.label}
            </button>
          ))}
        </div>

        <p className={styles.footerLink}>
          New here? <a href="/register">Create an account</a>
        </p>
      </form>
    </main>
  );
}

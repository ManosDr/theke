"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
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
        ...(mode === "invite" ? { invite_token: inviteToken } : { company_name: companyName, company_type: companyType }),
      });
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Is it running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.themeToggle}>
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
            Create a new company
          </button>
          <button
            type="button"
            className={`btn ${mode === "invite" ? "btn-primary" : "btn-secondary"} ${styles.fullRow}`}
            onClick={() => setMode("invite")}
          >
            I have an invite
          </button>
        </div>

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
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        {mode === "invite" ? (
          <div className={styles.field}>
            <label htmlFor="inviteToken">Invite code</label>
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
              <label htmlFor="companyName">Company / municipality name</label>
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
              <label htmlFor="companyType">Account type</label>
              <select
                id="companyType"
                className="input"
                value={companyType}
                onChange={(e) => setCompanyType(e.target.value as "construction" | "municipality")}
              >
                <option value="construction">Construction company</option>
                <option value="municipality">Municipality</option>
              </select>
            </div>
          </>
        )}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </button>

        <p className={styles.footerLink}>
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </form>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { ProjectSummary } from "../lib/types";
import styles from "./dashboard.module.css";

export function MemberDashboard() {
  const { user } = useAuth();
  const token = user?.token ?? null;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    if (!token) return;
    api
      .get<ProjectSummary[]>("/projects", token)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [token]);

  const defaultProjects = projects.filter((p) => p.is_default);

  return (
    <div>
      <h1>Welcome back</h1>
      <p className="text-muted">
        You're signed in as a {user?.companyType === "municipality" ? "municipality" : "company"} member.
      </p>

      <div className={styles.grid}>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{projects.length}</span>
          <span className={styles.statLabel}>Projects</span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{defaultProjects.length}</span>
          <span className={styles.statLabel}>Default municipalities</span>
        </div>
      </div>

      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <h2>Your projects</h2>
        </div>
        {projects.length === 0 ? (
          <p className={styles.emptyState}>No projects yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Municipality</th>
                <th>Default</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.municipality}</td>
                  <td>{p.is_default ? <span className="badge badge-success">Default</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={`card ${styles.section}`} style={{ textAlign: "center" }}>
        <h2>Ready to ask a question?</h2>
        <p className="text-muted">Search the shared knowledge base and your company&apos;s own documents.</p>
        <Link href="/chat" className="btn btn-primary">
          Open chat
        </Link>
      </section>
    </div>
  );
}

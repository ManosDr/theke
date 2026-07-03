"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_URL, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { BuildingIcon, FlagIcon } from "../components/StatIcons";
import type { MyCompanySummary, ProjectSummary } from "../lib/types";
import { StatCard } from "./StatCard";
import styles from "./dashboard.module.css";

export function MemberDashboard() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;
  const isConstruction = user?.companyType !== "municipality";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [company, setCompany] = useState<MyCompanySummary | null>(null);

  useEffect(() => {
    if (!token || !isConstruction) return;
    api
      .get<ProjectSummary[]>("/projects", token)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [token, isConstruction]);

  useEffect(() => {
    if (!token) return;
    api
      .get<MyCompanySummary>("/companies/me", token)
      .then(setCompany)
      .catch(() => setCompany(null));
  }, [token]);

  const defaultProjects = projects.filter((p) => p.is_default);

  return (
    <div>
      {company?.type === "municipality" && company.has_logo && (
        <img
          src={`${API_URL}/companies/${company.id}/logo`}
          alt={t("dash.company.logoAlt", { name: company.name })}
          className={styles.welcomeLogo}
        />
      )}
      <h1>{t("dash.member.welcome")}</h1>
      <p className="text-muted">
        {user?.companyType === "municipality"
          ? t("dash.member.signedInAsMunicipality", { name: company?.name ?? "" })
          : t("dash.member.signedInAsConstruction")}
      </p>

      {isConstruction && (
        <>
          <div className={styles.grid}>
            <StatCard tone="primary" icon={<BuildingIcon />} value={projects.length} label={t("dash.member.projects")} />
            <StatCard tone="info" icon={<FlagIcon />} value={defaultProjects.length} label={t("dash.member.defaultMunicipalities")} />
          </div>

          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{t("dash.member.yourProjects")}</h2>
            </div>
            {projects.length === 0 ? (
              <p className={styles.emptyState}>{t("dash.member.noProjects")}</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("dash.member.colName")}</th>
                    <th>{t("dash.member.colMunicipality")}</th>
                    <th>{t("dash.member.colDefault")}</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.municipality}</td>
                      <td>{p.is_default ? <span className="badge badge-success">{t("dash.member.default")}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <section className={`card ${styles.section}`} style={{ textAlign: "center" }}>
        <h2>{t("dash.member.readyToAsk")}</h2>
        <p className="text-muted">{t("dash.member.searchDescription")}</p>
        <Link href="/chat" className="btn btn-primary">
          {t("dash.member.openChat")}
        </Link>
      </section>
    </div>
  );
}

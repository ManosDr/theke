"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_URL, ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { BuildingIcon, FlagIcon } from "../components/StatIcons";
import type { MyCompanySummary, ProjectSummary, RegionSummary } from "../lib/types";
import { StatCard } from "./StatCard";
import styles from "./dashboard.module.css";

export function MemberDashboard() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;
  const isConstruction = user?.companyType !== "municipality";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [company, setCompany] = useState<MyCompanySummary | null>(null);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [newRegionId, setNewRegionId] = useState("");
  const [newAddress, setNewAddress] = useState("");

  function refreshProjects() {
    if (!token) return;
    api
      .get<ProjectSummary[]>("/projects", token)
      .then(setProjects)
      .catch(() => setProjects([]));
  }

  useEffect(() => {
    if (!token || !isConstruction) return;
    refreshProjects();
    api
      .get<RegionSummary[]>("/projects/regions", token)
      .then(setRegions)
      .catch(() => setRegions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isConstruction]);

  useEffect(() => {
    if (!token) return;
    api
      .get<MyCompanySummary>("/companies/me", token)
      .then(setCompany)
      .catch(() => setCompany(null));
  }, [token]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const region = regions.find((r) => r.region_id === newRegionId);
    try {
      await api.post<ProjectSummary>(
        "/projects",
        {
          name: newName.trim(),
          municipality: region?.region_name_el ?? "",
          region_id: newRegionId || undefined,
          address: newAddress.trim() || undefined,
        },
        token
      );
      setNewName("");
      setNewRegionId("");
      setNewAddress("");
      refreshProjects();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("dash.member.failedToCreateProject"));
    }
  }

  async function setDefault(projectId: number) {
    await api.post(`/projects/${projectId}/default`, undefined, token);
    refreshProjects();
  }

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
              <Link href="/projects/new" className="btn btn-primary">
                {t("project.new.title")}
              </Link>
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
                      <td>
                        <Link href={`/projects/${p.id}`}>{p.name}</Link>
                        {p.lat != null && p.lon != null && (
                          <span title={p.plot_address ?? t("project.list.hasLocation")} style={{ marginLeft: 6 }}>
                            📍
                          </span>
                        )}
                      </td>
                      <td>{p.municipality}</td>
                      <td>
                        {p.is_default ? (
                          <span className="badge badge-success">{t("dash.member.default")}</span>
                        ) : (
                          <button type="button" className="btn btn-secondary" onClick={() => setDefault(p.id)}>
                            {t("dash.member.setDefault")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form className={styles.inlineForm} onSubmit={createProject} style={{ marginTop: "var(--space-4)" }}>
              <input
                className="input"
                type="text"
                placeholder={t("dash.member.projectNamePlaceholder")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
              <select
                className="input"
                value={newRegionId}
                onChange={(e) => setNewRegionId(e.target.value)}
                required
              >
                <option value="" disabled>
                  {t("dash.member.selectMunicipality")}
                </option>
                {regions.map((r) => (
                  <option key={r.region_id} value={r.region_id}>
                    {r.region_name_el}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="text"
                placeholder={t("dash.member.addressPlaceholder")}
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">
                {t("dash.member.addProject")}
              </button>
            </form>
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

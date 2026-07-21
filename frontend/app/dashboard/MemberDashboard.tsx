"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_URL, ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { BuildingIcon, FlagIcon } from "../components/StatIcons";
import { PinIcon } from "../components/UiIcons";
import FieldError from "../components/FieldError";
import type { CustomerSummary, MyCompanySummary, ProjectSummary, RegionSummary } from "../lib/types";
import { StatCard } from "./StatCard";
import { WelcomeCard } from "./WelcomeCard";
import styles from "./dashboard.module.css";

export function MemberDashboard() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const token = user?.token ?? null;
  const isMunicipality = user?.companyType === "municipality";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [company, setCompany] = useState<MyCompanySummary | null>(null);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [newRegionId, setNewRegionId] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newClientNotes, setNewClientNotes] = useState("");
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [newFieldErrors, setNewFieldErrors] = useState<{ name?: string; region?: string }>({});

  // The construction vertical's "Projects" (region/plot-based) and the tax
  // vertical's "Clients" (name + notes, no region) are the same backend
  // model (Project, is_client auto-set server-side per vertical) - which
  // form/labels to show is driven by the company's actual vertical, not
  // the cruder companyType !== "municipality" check this used to use
  // (that treated any non-municipality company, including "accounting",
  // as construction).
  const usesRegionalScoping = company?.vertical_uses_regional_scoping ?? !isMunicipality;
  const showProjectSection = !isMunicipality && company !== null;

  function refreshProjects() {
    if (!token) return;
    api
      .get<ProjectSummary[]>("/projects", token)
      .then(setProjects)
      .catch(() => setProjects([]));
  }

  useEffect(() => {
    if (!token || isMunicipality) return;
    refreshProjects();
    if (usesRegionalScoping) {
      api
        .get<RegionSummary[]>("/projects/regions", token)
        .then(setRegions)
        .catch(() => setRegions([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isMunicipality, usesRegionalScoping]);

  useEffect(() => {
    if (!token) return;
    api
      .get<MyCompanySummary>("/companies/me", token)
      .then(setCompany)
      .catch(() => setCompany(null));
  }, [token]);

  function refreshCustomers() {
    if (!token) return;
    api
      .get<CustomerSummary[]>("/customers", token)
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }

  useEffect(() => {
    if (!token || isMunicipality) return;
    refreshCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isMunicipality]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const errors: typeof newFieldErrors = {};
    if (!newName.trim()) errors.name = t("validation.fieldRequired");
    if (usesRegionalScoping && !newRegionId) errors.region = t("validation.selectRequired");
    setNewFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const region = regions.find((r) => r.region_id === newRegionId);
    try {
      await api.post<ProjectSummary>(
        "/projects",
        usesRegionalScoping
          ? {
              name: newName.trim(),
              municipality: region?.region_name_el ?? "",
              region_id: newRegionId || undefined,
              address: newAddress.trim() || undefined,
            }
          : {
              name: newName.trim(),
              client_notes: newClientNotes.trim() || undefined,
            },
        token
      );
      setNewName("");
      setNewRegionId("");
      setNewAddress("");
      setNewClientNotes("");
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
  const isFirstRun =
    !isMunicipality &&
    company !== null &&
    projects.length === 0 &&
    customers.length === 0 &&
    !company.current_user_has_messages;

  return (
    <div>
      {company && user && (
        <WelcomeCard
          companyId={company.id}
          userEmail={user.email}
          verticalSlug={company.vertical_slug}
          verticalDisplayName={company.vertical_display_name}
          show={isFirstRun}
        />
      )}
      {company?.type === "municipality" && company.has_logo && (
        <img
          src={`${API_URL}/companies/${company.id}/logo`}
          alt={t("dash.company.logoAlt", { name: company.name })}
          className={styles.welcomeLogo}
        />
      )}
      <h1>{t("dash.member.welcome")}</h1>
      <p className="text-muted">
        {isMunicipality
          ? t("dash.member.signedInAsMunicipality", { name: company?.name ?? "" })
          : usesRegionalScoping
            ? t("dash.member.signedInAsConstruction")
            : t("dash.member.signedInAsAccounting")}
      </p>

      {showProjectSection && (
        <>
          <div className={styles.grid}>
            <StatCard
              tone="primary"
              icon={<BuildingIcon />}
              value={projects.length}
              label={usesRegionalScoping ? t("dash.member.projects") : t("dash.member.clients")}
            />
            {usesRegionalScoping && (
              <StatCard tone="info" icon={<FlagIcon />} value={defaultProjects.length} label={t("dash.member.defaultMunicipalities")} />
            )}
          </div>

          <section className={`card ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <h2>{usesRegionalScoping ? t("dash.member.yourProjects") : t("dash.member.yourClients")}</h2>
              {usesRegionalScoping && (
                <Link href="/projects/new" className="btn btn-primary">
                  {t("project.new.title")}
                </Link>
              )}
            </div>
            {projects.length === 0 ? (
              <p className={styles.emptyState}>
                {usesRegionalScoping ? t("dash.member.noProjects") : t("dash.member.noClients")}
              </p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{tUpper("dash.member.colName")}</th>
                    {usesRegionalScoping ? (
                      <>
                        <th>{tUpper("dash.member.colMunicipality")}</th>
                        <th>{tUpper("dash.member.colDefault")}</th>
                      </>
                    ) : (
                      <th>{tUpper("dash.member.colClientNotes")}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/projects/${p.id}`}>{p.name}</Link>
                        {p.lat != null && p.lon != null && (
                          <span
                            title={p.plot_address ?? t("project.list.hasLocation")}
                            style={{ marginLeft: 6, display: "inline-flex", verticalAlign: "middle", color: "var(--color-text-muted)" }}
                          >
                            <PinIcon size={14} />
                          </span>
                        )}
                      </td>
                      {usesRegionalScoping ? (
                        <>
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
                        </>
                      ) : (
                        <td className="text-muted">{p.client_notes ?? "—"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form className={styles.inlineForm} onSubmit={createProject} style={{ marginTop: "var(--space-4)" }} noValidate>
              <div>
                <input
                  className="input"
                  type="text"
                  placeholder={usesRegionalScoping ? t("dash.member.projectNamePlaceholder") : t("dash.member.clientNamePlaceholder")}
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (e.target.value.trim()) setNewFieldErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                  aria-invalid={!!newFieldErrors.name}
                />
                {newFieldErrors.name && <FieldError message={newFieldErrors.name} />}
              </div>
              {usesRegionalScoping ? (
                <>
                  <div>
                    <select
                      className="input"
                      value={newRegionId}
                      onChange={(e) => {
                        setNewRegionId(e.target.value);
                        if (e.target.value) setNewFieldErrors((prev) => ({ ...prev, region: undefined }));
                      }}
                      aria-invalid={!!newFieldErrors.region}
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
                    {newFieldErrors.region && <FieldError message={newFieldErrors.region} />}
                  </div>
                  <input
                    className="input"
                    type="text"
                    placeholder={t("dash.member.addressPlaceholder")}
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                  />
                </>
              ) : (
                <input
                  className="input"
                  type="text"
                  placeholder={t("dash.member.clientNotesPlaceholder")}
                  value={newClientNotes}
                  onChange={(e) => setNewClientNotes(e.target.value)}
                />
              )}
              <button type="submit" className="btn btn-primary">
                {usesRegionalScoping ? t("dash.member.addProject") : t("dash.member.addClient")}
              </button>
            </form>
          </section>
        </>
      )}

      {!isMunicipality && company !== null && (
        <section className={`card ${styles.section}`}>
          <div className={styles.sectionHeader}>
            <h2>{t("customer.customersTab")}</h2>
          </div>
          {customers.length === 0 ? (
            <p className={styles.emptyState}>{t("customer.customersEmpty")}</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{tUpper("customer.colName")}</th>
                  <th>{tUpper("customer.colAfm")}</th>
                  <th>{tUpper("customer.colProjects")}</th>
                  <th>{tUpper("customer.colLastProject")}</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/customers/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{c.afm ?? "—"}</td>
                    <td>{c.project_count}</td>
                    <td>{c.last_project_at ? new Date(c.last_project_at).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
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

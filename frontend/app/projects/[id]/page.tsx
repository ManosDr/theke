"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import CustomerCombobox, { type CustomerComboboxState } from "../../components/CustomerCombobox";
import FieldError from "../../components/FieldError";
import type { PinState } from "../../components/MapPicker";
import ProjectDocumentsPanel from "../../components/ProjectDocumentsPanel";
import { InfoIcon } from "../../components/StatIcons";
import Tooltip from "../../components/Tooltip";
import { ApiError, api } from "../../lib/api";
import { RequireAuth, useAuth } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";
import type { CustomerDetailResponse, MyCompanySummary, ProjectSummary, ResolveLocationResponse } from "../../lib/types";
import styles from "./page.module.css";

const MapPicker = dynamic(() => import("../../components/MapPicker"), { ssr: false });

type Tab = "info" | "documents";

function ProjectDetailContent() {
  const { user } = useAuth();
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const token = user?.token ?? null;

  const [company, setCompany] = useState<MyCompanySummary | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("info");

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCustomerNotes, setEditCustomerNotes] = useState("");
  const [editClientNotes, setEditClientNotes] = useState("");
  const [editCustomerState, setEditCustomerState] = useState<CustomerComboboxState>({ customerId: null, newCustomer: null });
  const [customerDetail, setCustomerDetail] = useState<CustomerDetailResponse | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const [editingLocation, setEditingLocation] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveLocationResponse | null>(null);
  const [plotInPlan, setPlotInPlan] = useState<boolean | null>(null);
  const [editingZone, setEditingZone] = useState(false);

  const usesRegionalScoping = company?.vertical_uses_regional_scoping ?? true;

  useEffect(() => {
    if (!token) return;
    api
      .get<MyCompanySummary>("/companies/me", token)
      .then(setCompany)
      .catch(() => setCompany(null));
  }, [token]);

  function load() {
    if (!token) return;
    api
      .get<ProjectSummary>(`/projects/${params.id}`, token)
      .then((p) => {
        setProject(p);
        setEditName(p.name ?? "");
        setEditCustomerNotes(p.customer_notes ?? "");
        setEditClientNotes(p.client_notes ?? "");
        setEditCustomerState({ customerId: p.customer_id ?? null, newCustomer: null });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t("project.detail.notFound")));
  }

  useEffect(load, [params.id, token]);

  // Customer info (name/AFM/phone/email) shown on the tax-vertical read
  // view comes from the linked customer record, not ProjectSummary itself
  // (which only carries customer_id/customer_name - the latter is the
  // legacy freeform field, not this record's actual contact details).
  useEffect(() => {
    if (!token || !project?.customer_id) {
      setCustomerDetail(null);
      return;
    }
    api
      .get<CustomerDetailResponse>(`/customers/${project.customer_id}`, token)
      .then(setCustomerDetail)
      .catch(() => setCustomerDetail(null));
  }, [token, project?.customer_id]);

  async function saveMetadata(e: React.FormEvent) {
    e.preventDefault();

    if (usesRegionalScoping && !editName.trim()) {
      setNameError(t("project.new.errorTitle"));
      return;
    }
    setNameError(null);

    let customerId = editCustomerState.customerId;
    if (editCustomerState.newCustomer) {
      const created = await api.post<{ id: number }>(
        "/customers",
        {
          name: editCustomerState.newCustomer.name.trim(),
          afm: editCustomerState.newCustomer.afm.trim() || undefined,
          phone: editCustomerState.newCustomer.phone.trim() || undefined,
          email: editCustomerState.newCustomer.email.trim() || undefined,
        },
        token
      );
      customerId = created.id;
    }

    const updated = await api.patch<ProjectSummary>(
      `/projects/${params.id}`,
      usesRegionalScoping
        ? { name: editName.trim(), customer_id: customerId ?? undefined, customer_notes: editCustomerNotes.trim() || undefined }
        : { name: editName.trim(), client_notes: editClientNotes.trim() || undefined, customer_id: customerId ?? undefined },
      token
    );
    setProject(updated);
    setEditing(false);
    setEditingLocation(false);
  }

  async function handlePick(lat: number, lon: number, kaek?: string) {
    setPin({ lat, lon });
    setResolved(null);
    setResolving(true);
    try {
      const result = await api.post<ResolveLocationResponse>("/gis/resolve-location", { lat, lon, kaek }, token);
      setResolved(result);
    } catch {
      setResolved(null);
    } finally {
      setResolving(false);
    }
  }

  async function saveLocation() {
    if (!pin || !resolved) return;
    const updated = await api.patch<ProjectSummary>(
      `/projects/${params.id}/location`,
      {
        lat: pin.lat,
        lon: pin.lon,
        plot_address: resolved.address,
        plot_municipality: resolved.municipality,
        kaek: resolved.kaek,
        plot_area_sqm: resolved.plot_area_sqm,
        parcel_geometry: resolved.parcel_geometry,
        gis_zone_name: resolved.gis_zone_name,
        gis_zone_source: resolved.gis_zone_name ? "manual_entry" : null,
        archaeological_flag: resolved.archaeological_flag,
        archaeological_notes: resolved.archaeological_notes,
        archaeological_site_name: resolved.archaeological_site_name,
        archaeological_distance_m: resolved.archaeological_distance_m,
        plot_in_plan: plotInPlan,
      },
      token
    );
    setProject(updated);
    setEditingLocation(false);
    setEditing(false);
    setPin(null);
    setResolved(null);
  }

  async function saveZone(value: boolean) {
    const updated = await api.patch<ProjectSummary>(`/projects/${params.id}/plot-in-plan`, { plot_in_plan: value }, token);
    setProject(updated);
    setEditingZone(false);
  }

  function pinState(): PinState {
    if (resolving) return "loading";
    if (!resolved) return "resolved";
    if (resolved.archaeological_flag) return "archaeological";
    return "resolved";
  }

  if (error) return <p>{error}</p>;
  if (!project) return <p className="text-muted">{t("common.loading")}</p>;

  const hasLocation = project.lat != null && project.lon != null;

  if (!usesRegionalScoping) {
    return (
      <div>
        <Link href="/dashboard" className={styles.backLink}>
          {t("project.new.back")}
        </Link>

        <div className={styles.header}>
          <h1>{project.name}</h1>
          <Link href={`/chat?project_id=${project.id}`} className="btn btn-primary">
            {t("nav.chat")}
          </Link>
        </div>

        <div className={styles.tabs}>
          <button type="button" className={tab === "info" ? styles.tabActive : styles.tab} onClick={() => setTab("info")}>
            {t("project.detail.tabInfo")}
          </button>
          <button type="button" className={tab === "documents" ? styles.tabActive : styles.tab} onClick={() => setTab("documents")}>
            {t("project.detail.tabDocuments")}
          </button>
        </div>

        {tab === "documents" && <ProjectDocumentsPanel projectId={Number(params.id)} token={token} />}

        {tab === "info" && (
          <div className={`card ${styles.customerCard}`} style={{ padding: "var(--space-4)" }}>
            {editing ? (
              <form onSubmit={saveMetadata} noValidate>
                <label className={styles.field}>
                  {t("project.new.clientName")}
                  <CustomerCombobox token={token} onChange={setEditCustomerState} />
                </label>
                <label className={styles.field}>
                  {t("dash.member.colClientNotes")}
                  <textarea className="input" rows={3} value={editClientNotes} onChange={(e) => setEditClientNotes(e.target.value)} />
                </label>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <button type="submit" className="btn btn-primary">{t("common.save")}</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>{t("common.cancel")}</button>
                </div>
              </form>
            ) : (
              <>
                <dl className={styles.metaGrid}>
                  <dt>{t("customer.name")}</dt>
                  <dd>{customerDetail?.name || project.customer_name || "—"}</dd>
                  <dt>{t("customer.afm")}</dt>
                  <dd>{customerDetail?.afm ?? "—"}</dd>
                  <dt>{t("customer.phone")}</dt>
                  <dd>{customerDetail?.phone ?? "—"}</dd>
                  <dt>{t("customer.email")}</dt>
                  <dd>{customerDetail?.email ?? "—"}</dd>
                  <dt>{t("dash.member.colClientNotes")}</dt>
                  <dd>{project.client_notes || "—"}</dd>
                </dl>
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                  {t("project.detail.edit")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <Link href="/dashboard" className={styles.backLink}>
        {t("project.new.back")}
      </Link>

      <div className={styles.header}>
        <div>
          <h1>{project.name}</h1>
          <p className="text-muted">
            {(customerDetail?.name || project.customer_name) && (
              <span>{t("project.detail.customer")}: {customerDetail?.name || project.customer_name} · </span>
            )}
            {project.municipality && <span className="badge badge-success">{project.municipality}</span>}
          </p>
        </div>
        <Link href={`/chat?project_id=${project.id}`} className="btn btn-primary">
          {t("nav.chat")}
        </Link>
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={tab === "info" ? styles.tabActive : styles.tab}
          onClick={() => setTab("info")}
        >
          {t("project.detail.tabInfo")}
        </button>
        <button
          type="button"
          className={tab === "documents" ? styles.tabActive : styles.tab}
          onClick={() => setTab("documents")}
        >
          {t("project.detail.tabDocuments")}
        </button>
      </div>

      {tab === "documents" && <ProjectDocumentsPanel projectId={Number(params.id)} token={token} />}

      {tab === "info" && (
        <div className={styles.layout}>
          <div className="card" style={{ padding: "var(--space-4)" }}>
            {editing ? (
              <form onSubmit={saveMetadata} noValidate>
                <label className={styles.field}>
                  {t("project.new.projectName")}
                  <input
                    className="input"
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      if (e.target.value.trim()) setNameError(null);
                    }}
                    aria-invalid={!!nameError}
                  />
                  {nameError && <FieldError message={nameError} />}
                </label>
                <label className={styles.field}>
                  {t("project.new.customerName")}
                  <CustomerCombobox token={token} onChange={setEditCustomerState} />
                </label>
                <label className={styles.field}>
                  {t("project.new.customerNotes")}
                  <textarea className="input" rows={3} value={editCustomerNotes} onChange={(e) => setEditCustomerNotes(e.target.value)} />
                </label>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <button type="submit" className="btn btn-primary">{t("common.save")}</button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditing(false);
                      setEditingLocation(false);
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <dl className={styles.metaGrid}>
                  <dt>{t("project.detail.customer")}</dt>
                  <dd>{customerDetail?.name || project.customer_name || "—"}</dd>
                  <dt>{t("project.detail.region")}</dt>
                  <dd>{project.municipality || "—"}</dd>
                  {project.customer_notes && (
                    <>
                      <dt>{t("project.new.customerNotes")}</dt>
                      <dd>{project.customer_notes}</dd>
                    </>
                  )}
                </dl>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    // One "Επεξεργασία" action opens the whole page's edit
                    // mode (name/customer/notes here, KAEK/address/pin on
                    // the right) rather than two separately-triggered forms
                    // - viewing stays read-only until this is clicked, per
                    // the "map + info only, nothing editable" spec.
                    setEditing(true);
                    if (hasLocation) {
                      setPlotInPlan(project.plot_in_plan ?? null);
                      setEditingLocation(true);
                    }
                  }}
                >
                  {t("project.detail.edit")}
                </button>
              </>
            )}
          </div>

          <div>
            {!hasLocation && !editingLocation && (
              <div className="card" style={{ padding: "var(--space-5)", textAlign: "center" }}>
                <p className="text-muted">{t("map.notDetermined")}</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setPlotInPlan(project.plot_in_plan ?? null);
                    setEditingLocation(true);
                  }}
                >
                  {t("project.detail.addLocation")}
                </button>
              </div>
            )}

            {hasLocation && !editingLocation && (
              <div>
                <MapPicker lat={project.lat ?? null} lon={project.lon ?? null} pinState="resolved" onPick={() => {}} height={280} />
                <div className={`card ${styles.locationPanel}`}>
                  <div className={styles.locationRow}>
                    <span>📍 {t("map.address")}</span>
                    <span>{project.plot_address ?? "—"}</span>
                  </div>
                  <div className={styles.locationRow}>
                    <span>🔢 {t("map.kaek")}</span>
                    <span>{project.kaek ?? t("map.notFound")}</span>
                  </div>
                  <div className={styles.locationRow}>
                    <span>📐 {t("map.area")}</span>
                    <span>{project.plot_area_sqm != null ? `${project.plot_area_sqm} ${t("map.areaUnit")}` : t("map.notAvailable")}</span>
                  </div>
                  <div className={styles.locationRow}>
                    <span>
                      🗺 {t("map.zone")}
                      <Tooltip text={t("map.zoneTooltip")}>
                        <InfoIcon size={13} />
                      </Tooltip>
                    </span>
                    <span>{project.gis_zone_name ?? t("map.notDetermined")}</span>
                  </div>
                  <div className={styles.locationRow}>
                    <span>{t("map.zoneToggleLabel")}</span>
                    {editingZone ? (
                      <span style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                        <button type="button" className="btn btn-secondary" onClick={() => saveZone(true)}>
                          {t("map.zoneInPlan")}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => saveZone(false)}>
                          {t("map.zoneOutOfPlan")}
                        </button>
                        <button type="button" className={styles.tab} onClick={() => setEditingZone(false)}>
                          {t("common.cancel")}
                        </button>
                      </span>
                    ) : project.plot_in_plan != null ? (
                      <button
                        type="button"
                        className={project.plot_in_plan ? "badge badge-success" : "badge badge-warning"}
                        style={{ border: "none", cursor: "pointer" }}
                        onClick={() => setEditingZone(true)}
                      >
                        {project.plot_in_plan ? t("map.zoneInPlan") : t("map.zoneOutOfPlan")}
                      </button>
                    ) : (
                      <button type="button" className={styles.tab} onClick={() => setEditingZone(true)}>
                        {t("map.zoneSetLink")}
                      </button>
                    )}
                  </div>
                  {project.archaeological_flag && (
                    <div className={styles.archaeologicalCard}>
                      <strong>⚠ {t("map.archaeologicalWarning")}</strong>
                      {project.archaeological_notes && <p>{project.archaeological_notes}</p>}
                      <p className="text-muted" style={{ fontSize: "0.8rem" }}>
                        {t("map.archaeologicalDisclaimer")}
                      </p>
                    </div>
                  )}
                  {!project.archaeological_flag && (
                    <p className="text-muted" style={{ fontSize: "0.78rem" }}>
                      {t("map.noArchaeologicalDataNote")}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: "var(--space-3)" }}
                  onClick={() => {
                    setPlotInPlan(project.plot_in_plan ?? null);
                    setEditingLocation(true);
                  }}
                >
                  {t("project.detail.updateLocation")}
                </button>
              </div>
            )}

            {editingLocation && (
              <div>
                <MapPicker
                  lat={pin?.lat ?? project.lat ?? null}
                  lon={pin?.lon ?? project.lon ?? null}
                  pinState={pinState()}
                  onPick={handlePick}
                  height={280}
                  token={token}
                />
                {resolving && <p className="text-muted">{t("map.resolving")}</p>}
                {resolved && (
                  <div className={`card ${styles.locationPanel}`} style={{ marginTop: "var(--space-3)" }}>
                    <span style={{ display: "block", fontWeight: 600, marginBottom: "var(--space-2)" }}>
                      {t("map.zoneToggleLabel")}
                    </span>
                    <div style={{ display: "flex", gap: "var(--space-4)" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer" }}>
                        <input type="radio" name="plotInPlanEdit" checked={plotInPlan === true} onChange={() => setPlotInPlan(true)} />
                        {t("map.zoneInPlan")}
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer" }}>
                        <input type="radio" name="plotInPlanEdit" checked={plotInPlan === false} onChange={() => setPlotInPlan(false)} />
                        {t("map.zoneOutOfPlan")}
                      </label>
                    </div>
                    <p className="text-muted" style={{ fontSize: "0.78rem", marginTop: "var(--space-2)", marginBottom: 0 }}>
                      {t("map.zoneToggleNote")}
                    </p>
                    <p className="text-muted" style={{ fontSize: "0.78rem", marginTop: "var(--space-1)", marginBottom: 0 }}>
                      {t("map.zoneToggleManualHelp")}
                    </p>
                  </div>
                )}
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                  <button type="button" className="btn btn-primary" disabled={!resolved} onClick={saveLocation}>
                    {t("common.save")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditingLocation(false);
                      setEditing(false);
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  return (
    <RequireAuth>
      <AppShell>
        <ProjectDetailContent />
      </AppShell>
    </RequireAuth>
  );
}

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import type { PinState } from "../../components/MapPicker";
import { ApiError, api } from "../../lib/api";
import { RequireAuth, useAuth } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";
import type { MyCompanySummary, ProjectSummary, ResolveLocationResponse } from "../../lib/types";
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
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerNotes, setEditCustomerNotes] = useState("");
  const [editClientNotes, setEditClientNotes] = useState("");

  const [editingLocation, setEditingLocation] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveLocationResponse | null>(null);

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
        setEditCustomerName(p.customer_name ?? "");
        setEditCustomerNotes(p.customer_notes ?? "");
        setEditClientNotes(p.client_notes ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t("project.detail.notFound")));
  }

  useEffect(load, [params.id, token]);

  async function saveMetadata(e: React.FormEvent) {
    e.preventDefault();
    const updated = await api.patch<ProjectSummary>(
      `/projects/${params.id}`,
      usesRegionalScoping
        ? { name: editName.trim(), customer_name: editCustomerName.trim() || undefined, customer_notes: editCustomerNotes.trim() || undefined }
        : { name: editName.trim(), client_notes: editClientNotes.trim() || undefined },
      token
    );
    setProject(updated);
    setEditing(false);
  }

  async function handlePick(lat: number, lon: number) {
    setPin({ lat, lon });
    setResolved(null);
    setResolving(true);
    try {
      const result = await api.post<ResolveLocationResponse>("/gis/resolve-location", { lat, lon }, token);
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
      },
      token
    );
    setProject(updated);
    setEditingLocation(false);
    setPin(null);
    setResolved(null);
  }

  function pinState(): PinState {
    if (resolving) return "loading";
    if (!resolved) return "resolved";
    if (resolved.archaeological_flag) return "archaeological";
    if (!resolved.services_available.cadastral || !resolved.services_available.gis_zone) return "partial";
    return "resolved";
  }

  if (error) return <p>{error}</p>;
  if (!project) return <p className="text-muted">{t("common.loading")}</p>;

  const hasLocation = project.lat != null && project.lon != null;

  if (!usesRegionalScoping) {
    return (
      <div>
        <div className={styles.header}>
          <h1>{project.name}</h1>
        </div>

        <div className="card" style={{ padding: "var(--space-4)" }}>
          {editing ? (
            <form onSubmit={saveMetadata}>
              <label className={styles.field}>
                {t("project.new.clientName")}
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} required />
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
                <dt>{t("dash.member.colClientNotes")}</dt>
                <dd>{project.client_notes || "—"}</dd>
              </dl>
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                {t("project.detail.edit")}
              </button>
            </>
          )}
        </div>

        <Link href="/dashboard" className={styles.backLink}>
          {t("project.new.back")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>{project.name}</h1>
          <p className="text-muted">
            {project.customer_name && <span>{t("project.detail.customer")}: {project.customer_name} · </span>}
            {project.municipality && <span className="badge badge-success">{project.municipality}</span>}
          </p>
        </div>
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

      {tab === "documents" && (
        <div className="card" style={{ padding: "var(--space-5)" }}>
          <p className="text-muted">{t("project.detail.documentsNotAvailable")}</p>
        </div>
      )}

      {tab === "info" && (
        <div className={styles.layout}>
          <div className="card" style={{ padding: "var(--space-4)" }}>
            {editing ? (
              <form onSubmit={saveMetadata}>
                <label className={styles.field}>
                  {t("project.new.projectName")}
                  <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} required />
                </label>
                <label className={styles.field}>
                  {t("project.new.customerName")}
                  <input className="input" value={editCustomerName} onChange={(e) => setEditCustomerName(e.target.value)} />
                </label>
                <label className={styles.field}>
                  {t("project.new.customerNotes")}
                  <textarea className="input" rows={3} value={editCustomerNotes} onChange={(e) => setEditCustomerNotes(e.target.value)} />
                </label>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <button type="submit" className="btn btn-primary">{t("common.save")}</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>{t("common.cancel")}</button>
                </div>
              </form>
            ) : (
              <>
                <dl className={styles.metaGrid}>
                  <dt>{t("project.detail.customer")}</dt>
                  <dd>{project.customer_name || "—"}</dd>
                  <dt>{t("project.detail.region")}</dt>
                  <dd>{project.municipality || "—"}</dd>
                  {project.customer_notes && (
                    <>
                      <dt>{t("project.new.customerNotes")}</dt>
                      <dd>{project.customer_notes}</dd>
                    </>
                  )}
                </dl>
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                  {t("project.detail.edit")}
                </button>
              </>
            )}
          </div>

          <div>
            {!hasLocation && !editingLocation && (
              <div className="card" style={{ padding: "var(--space-5)", textAlign: "center" }}>
                <p className="text-muted">{t("map.notDetermined")}</p>
                <button type="button" className="btn btn-primary" onClick={() => setEditingLocation(true)}>
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
                    <span>🗺 {t("map.zone")}</span>
                    <span>{project.gis_zone_name ?? t("map.notDetermined")}</span>
                  </div>
                  {project.archaeological_flag && (
                    <div className={styles.archaeologicalCard}>
                      <strong>⚠ {t("map.archaeologicalWarning")}</strong>
                      {project.archaeological_notes && <p>{project.archaeological_notes}</p>}
                    </div>
                  )}
                </div>
                <button type="button" className="btn btn-secondary" style={{ marginTop: "var(--space-3)" }} onClick={() => setEditingLocation(true)}>
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
                />
                {resolving && <p className="text-muted">{t("map.resolving")}</p>}
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                  <button type="button" className="btn btn-primary" disabled={!resolved} onClick={saveLocation}>
                    {t("common.save")}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingLocation(false)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Link href="/dashboard" className={styles.backLink}>
        {t("project.new.back")}
      </Link>
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

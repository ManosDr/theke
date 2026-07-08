"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import type { PinState } from "../../components/MapPicker";
import { ApiError, api } from "../../lib/api";
import { RequireAuth, useAuth } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";
import type { ProjectSummary, RegionSummary, ResolveLocationResponse } from "../../lib/types";
import styles from "./page.module.css";

// react-leaflet touches `window` at import time - must be loaded client-only.
const MapPicker = dynamic(() => import("../../components/MapPicker"), { ssr: false });

function LocationSummary({ resolving, resolved }: { resolving: boolean; resolved: ResolveLocationResponse | null }) {
  const { t } = useLocale();
  if (resolving) return <p className="text-muted">{t("map.resolving")}</p>;
  if (!resolved) return null;

  const partial = !resolved.services_available.cadastral || !resolved.services_available.gis_zone;

  return (
    <div className={`card ${styles.locationPanel}`}>
      <div className={styles.locationRow}>
        <span>📍 {t("map.address")}</span>
        <span>{resolved.address ?? "—"}</span>
      </div>
      <div className={styles.locationRow}>
        <span>🔢 {t("map.kaek")}</span>
        <span>{resolved.kaek ?? t("map.notFound")}</span>
      </div>
      <div className={styles.locationRow}>
        <span>📐 {t("map.area")}</span>
        <span>{resolved.plot_area_sqm != null ? `${resolved.plot_area_sqm} ${t("map.areaUnit")}` : t("map.notAvailable")}</span>
      </div>
      <div className={styles.locationRow}>
        <span>🗺 {t("map.zone")}</span>
        <span>{resolved.gis_zone_name ?? t("map.notDetermined")}</span>
      </div>
      {resolved.archaeological_flag && (
        <div className={styles.archaeologicalCard}>
          <strong>⚠ {t("map.archaeologicalWarning")}</strong>
          {resolved.archaeological_notes && <p>{resolved.archaeological_notes}</p>}
        </div>
      )}
      {partial && !resolved.archaeological_flag && <p className={styles.partialNote}>{t("map.partialNote")}</p>}
    </div>
  );
}

function NewProjectContent() {
  const { user } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const token = user?.token ?? null;

  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [name, setName] = useState("");
  const [regionId, setRegionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveLocationResponse | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<RegionSummary[]>("/projects/regions", token)
      .then(setRegions)
      .catch(() => setRegions([]));
  }, [token]);

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

  function pinState(): PinState {
    if (resolving) return "loading";
    if (!resolved) return "resolved";
    if (resolved.archaeological_flag) return "archaeological";
    if (!resolved.services_available.cadastral || !resolved.services_available.gis_zone) return "partial";
    return "resolved";
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const region = regions.find((r) => r.region_id === regionId);
      const project = await api.post<ProjectSummary>(
        "/projects",
        {
          name: name.trim(),
          municipality: region?.region_name_el ?? "",
          region_id: regionId || undefined,
          customer_name: customerName.trim(),
          customer_notes: customerNotes.trim() || undefined,
        },
        token
      );

      if (pin && resolved) {
        await api.patch(
          `/projects/${project.id}/location`,
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
      }

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("project.new.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Link href="/dashboard" className={styles.backLink}>
        {t("project.new.back")}
      </Link>
      <h1>{t("project.new.title")}</h1>

      <form onSubmit={handleSave} className={styles.layout}>
        <div className={styles.formColumn}>
          <section className="card" style={{ padding: "var(--space-4)" }}>
            <h2 className={styles.sectionHeader}>{t("project.new.customerSection")}</h2>
            <label className={styles.field}>
              {t("project.new.customerName")}
              <input
                className="input"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              {t("project.new.customerNotes")}
              <textarea
                className="input"
                rows={3}
                placeholder={t("project.new.customerNotesPlaceholder")}
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
              />
            </label>
          </section>

          <section className="card" style={{ padding: "var(--space-4)", marginTop: "var(--space-4)" }}>
            <h2 className={styles.sectionHeader}>{t("project.new.projectSection")}</h2>
            <label className={styles.field}>
              {t("project.new.projectName")}
              <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className={styles.field}>
              {t("project.detail.region")}
              <select className="input" value={regionId} onChange={(e) => setRegionId(e.target.value)} required>
                <option value="" disabled>
                  {t("dash.member.selectMunicipality")}
                </option>
                {regions.map((r) => (
                  <option key={r.region_id} value={r.region_id}>
                    {r.region_name_el}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {error && (
            <p className="text-muted" style={{ color: "var(--color-danger)", marginTop: "var(--space-3)" }}>
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "var(--space-4)" }} disabled={saving}>
            {t("project.new.save")}
          </button>
          {!pin && <p className={styles.saveHint}>{t("project.new.saveHint")}</p>}
        </div>

        <div className={styles.mapColumn}>
          <h2 className={styles.sectionHeader}>{t("project.new.locationSection")}</h2>
          <MapPicker
            lat={pin?.lat ?? null}
            lon={pin?.lon ?? null}
            pinState={pinState()}
            onPick={handlePick}
            height={400}
            popupContent={
              resolved ? (
                <div>
                  {resolved.archaeological_flag && (
                    <p style={{ color: "var(--color-warning)", fontWeight: 700, marginBottom: 4 }}>
                      ⚠ {t("map.archaeologicalWarning")}
                    </p>
                  )}
                  <strong>{resolved.address ?? "—"}</strong>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>
                    {t("map.kaek")}: {resolved.kaek ?? t("map.notFound")} &middot; {t("map.area")}:{" "}
                    {resolved.plot_area_sqm ?? t("map.notAvailable")}
                  </div>
                  <div style={{ fontSize: 12.5 }}>
                    {t("map.zone")}: {resolved.gis_zone_name ?? t("map.notDetermined")}
                  </div>
                </div>
              ) : undefined
            }
          />
          <LocationSummary resolving={resolving} resolved={resolved} />
        </div>
      </form>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <RequireAuth>
      <AppShell>
        <NewProjectContent />
      </AppShell>
    </RequireAuth>
  );
}

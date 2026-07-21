"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import CustomerCombobox, { type CustomerComboboxState } from "../../components/CustomerCombobox";
import FieldError from "../../components/FieldError";
import type { PinState } from "../../components/MapPicker";
import { InfoIcon } from "../../components/StatIcons";
import Tooltip from "../../components/Tooltip";
import { HashIcon, MapIcon, PinIcon, RulerIcon, WarningIcon } from "../../components/UiIcons";
import { ApiError, api } from "../../lib/api";
import { RequireAuth, useAuth } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";
import type { MyCompanySummary, ProjectSummary, RegionSummary, ResolveLocationResponse } from "../../lib/types";
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
        <span><PinIcon size={13} /> {t("map.address")}</span>
        <span>{resolved.address ?? "—"}</span>
      </div>
      <div className={styles.locationRow}>
        <span><HashIcon size={13} /> {t("map.kaek")}</span>
        <span>{resolved.kaek ?? t("map.notFound")}</span>
      </div>
      <div className={styles.locationRow}>
        <span><RulerIcon size={13} /> {t("map.area")}</span>
        <span>{resolved.plot_area_sqm != null ? `${resolved.plot_area_sqm} ${t("map.areaUnit")}` : t("map.notAvailable")}</span>
      </div>
      <div className={styles.locationRow}>
        <span>
          <MapIcon size={13} /> {t("map.zone")}
          <Tooltip text={t("map.zoneTooltip")}>
            <InfoIcon size={13} />
          </Tooltip>
        </span>
        <span>{resolved.gis_zone_name ?? t("map.notDetermined")}</span>
      </div>
      {resolved.archaeological_flag && (
        <div className={styles.archaeologicalCard}>
          <strong><WarningIcon size={14} /> {t("map.archaeologicalWarning")}</strong>
          {resolved.archaeological_notes && <p>{resolved.archaeological_notes}</p>}
          <p className="text-muted" style={{ fontSize: "0.8rem" }}>
            {t("map.archaeologicalDisclaimer")}
          </p>
        </div>
      )}
      {!resolved.archaeological_flag && (
        <p className="text-muted" style={{ fontSize: "0.78rem" }}>
          {t("map.noArchaeologicalDataNote")}
        </p>
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

  const [company, setCompany] = useState<MyCompanySummary | null>(null);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [customerState, setCustomerState] = useState<CustomerComboboxState>({ customerId: null, newCustomer: null });
  const [name, setName] = useState("");
  const [clientNotes, setClientNotes] = useState("");
  const [regionId, setRegionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; region?: string; customer?: string }>({});
  // Bumped on every failed submit attempt so child fields (e.g. the
  // customer sub-form's own name/AFM checks) know to display their
  // validation state, without us lifting that state up into this component.
  const [validateSignal, setValidateSignal] = useState(0);

  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveLocationResponse | null>(null);
  const [plotInPlan, setPlotInPlan] = useState<boolean | null>(null);

  // Defaults to true (the construction map+plot form) while the company
  // hasn't loaded yet, matching this page's original construction-only
  // behavior - flips to the simpler client form once we know the vertical.
  const usesRegionalScoping = company?.vertical_uses_regional_scoping ?? true;

  useEffect(() => {
    if (!token) return;
    api
      .get<MyCompanySummary>("/companies/me", token)
      .then(setCompany)
      .catch(() => setCompany(null));
  }, [token]);

  useEffect(() => {
    if (!token || !usesRegionalScoping) return;
    api
      .get<RegionSummary[]>("/projects/regions", token)
      .then(setRegions)
      .catch(() => setRegions([]));
  }, [token, usesRegionalScoping]);

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

  function pinState(): PinState {
    if (resolving) return "loading";
    if (!resolved) return "resolved";
    if (resolved.archaeological_flag) return "archaeological";
    // Incomplete-service results still get the "resolved" checkmark - the
    // pin only communicates loading/resolved/archaeological; incompleteness
    // is surfaced via the partialNote text in LocationSummary instead.
    return "resolved";
  }

  function validate(): boolean {
    const errors: typeof fieldErrors = {};
    if (!name.trim()) errors.name = t("project.new.errorTitle");
    if (usesRegionalScoping && !regionId) errors.region = t("project.new.errorRegion");
    if (!customerState.customerId && !customerState.newCustomer) errors.customer = t("project.new.errorCustomer");
    setFieldErrors(errors);
    setValidateSignal((n) => n + 1);
    return Object.keys(errors).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setError(null);
    try {
      // A new-customer draft is created first (atomically ahead of the
      // project, not in parallel) so a customer-creation failure (e.g. a
      // duplicate ΑΦΜ) is caught and shown inline before any project row
      // exists - never a project silently left with no customer link. Same
      // resolution for both verticals, since the combobox is shared.
      let customerId = customerState.customerId;
      if (customerState.newCustomer) {
        try {
          const created = await api.post<{ id: number }>(
            "/customers",
            {
              name: customerState.newCustomer.name.trim(),
              afm: customerState.newCustomer.afm.trim() || undefined,
              phone: customerState.newCustomer.phone.trim() || undefined,
              email: customerState.newCustomer.email.trim() || undefined,
            },
            token
          );
          customerId = created.id;
        } catch (err) {
          setError(err instanceof ApiError ? err.message : t("project.new.failed"));
          setSaving(false);
          return;
        }
      }

      if (!usesRegionalScoping) {
        await api.post<ProjectSummary>(
          "/projects",
          { name: name.trim(), client_notes: clientNotes.trim() || undefined, customer_id: customerId ?? undefined },
          token
        );
        router.push("/dashboard");
        return;
      }

      const region = regions.find((r) => r.region_id === regionId);
      const project = await api.post<ProjectSummary>(
        "/projects",
        {
          name: name.trim(),
          municipality: region?.region_name_el ?? "",
          region_id: regionId || undefined,
          customer_id: customerId ?? undefined,
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
            archaeological_site_name: resolved.archaeological_site_name,
            archaeological_distance_m: resolved.archaeological_distance_m,
            plot_in_plan: plotInPlan,
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

  if (!usesRegionalScoping) {
    return (
      <div>
        <Link href="/dashboard" className={styles.backLink}>
          {t("project.new.back")}
        </Link>
        <h1>{t("project.new.clientTitle")}</h1>

        <form onSubmit={handleSave} className={styles.formColumn} noValidate>
          <section className={`card ${styles.customerCard}`} style={{ padding: "var(--space-4)" }}>
            <label className={styles.field}>
              {t("project.new.clientName")}
              <CustomerCombobox
                token={token}
                onChange={(state) => {
                  setCustomerState(state);
                  if (state.customerId || state.newCustomer) setFieldErrors((prev) => ({ ...prev, customer: undefined }));
                }}
                validateSignal={validateSignal}
              />
              {fieldErrors.customer && <FieldError message={fieldErrors.customer} />}
            </label>
            <label className={styles.field}>
              {t("project.new.projectName")}
              <input
                className="input"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, name: undefined }));
                }}
                aria-invalid={!!fieldErrors.name}
              />
              {fieldErrors.name && <FieldError message={fieldErrors.name} />}
            </label>
            <label className={styles.field}>
              {t("dash.member.colClientNotes")}
              <textarea
                className="input"
                rows={3}
                placeholder={t("dash.member.clientNotesPlaceholder")}
                value={clientNotes}
                onChange={(e) => setClientNotes(e.target.value)}
              />
            </label>
          </section>

          {error && (
            <p className="text-muted" style={{ color: "var(--color-danger)", marginTop: "var(--space-3)" }}>
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "var(--space-4)" }} disabled={saving}>
            {t("dash.member.addClient")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <Link href="/dashboard" className={styles.backLink}>
        {t("project.new.back")}
      </Link>
      <h1>{t("project.new.title")}</h1>

      <form onSubmit={handleSave} className={styles.layout} noValidate>
        <div className={styles.formColumn}>
          <section className={`card ${styles.customerCard}`} style={{ padding: "var(--space-4)" }}>
            <h2 className={styles.sectionHeader}>{t("project.new.customerSection")}</h2>
            <label className={styles.field}>
              {t("project.new.customerName")}
              <CustomerCombobox
                token={token}
                onChange={(state) => {
                  setCustomerState(state);
                  if (state.customerId || state.newCustomer) setFieldErrors((prev) => ({ ...prev, customer: undefined }));
                }}
                validateSignal={validateSignal}
              />
              {fieldErrors.customer && <FieldError message={fieldErrors.customer} />}
            </label>
          </section>

          <section className="card" style={{ padding: "var(--space-4)", marginTop: "var(--space-4)" }}>
            <h2 className={styles.sectionHeader}>{t("project.new.projectSection")}</h2>
            <label className={styles.field}>
              {t("project.new.projectName")}
              <input
                className="input"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setFieldErrors((prev) => ({ ...prev, name: undefined }));
                }}
                aria-invalid={!!fieldErrors.name}
              />
              {fieldErrors.name && <FieldError message={fieldErrors.name} />}
            </label>
            <label className={styles.field}>
              {t("project.detail.region")}
              <select
                className="input"
                value={regionId}
                onChange={(e) => {
                  setRegionId(e.target.value);
                  if (e.target.value) setFieldErrors((prev) => ({ ...prev, region: undefined }));
                }}
                aria-invalid={!!fieldErrors.region}
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
              {fieldErrors.region && <FieldError message={fieldErrors.region} />}
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
            token={token}
            popupContent={
              resolved ? (
                <div>
                  {resolved.archaeological_flag && (
                    <>
                      <p
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          color: "var(--color-warning)",
                          fontWeight: 700,
                          marginBottom: 4,
                        }}
                      >
                        <WarningIcon size={14} /> {t("map.archaeologicalWarning")}
                      </p>
                      <p style={{ fontSize: 11, marginBottom: 4 }}>{t("map.archaeologicalDisclaimer")}</p>
                    </>
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
          {resolved && (
            <div className={`card ${styles.locationPanel}`} style={{ marginTop: "var(--space-3)" }}>
              <span className={styles.sectionHeader} style={{ display: "block", marginBottom: "var(--space-2)" }}>
                {t("map.zoneToggleLabel")}
              </span>
              <div style={{ display: "flex", gap: "var(--space-4)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="plotInPlan"
                    checked={plotInPlan === true}
                    onChange={() => setPlotInPlan(true)}
                  />
                  {t("map.zoneInPlan")}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="plotInPlan"
                    checked={plotInPlan === false}
                    onChange={() => setPlotInPlan(false)}
                  />
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

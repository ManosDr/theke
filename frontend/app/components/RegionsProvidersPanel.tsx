"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { ProviderTypeBadge } from "./TypeBadge";
import type { RegionAdminSummary, UtilityProviderAdminSummary } from "../lib/types";
import dashStyles from "../dashboard/dashboard.module.css";

export function RegionsProvidersPanel() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const token = user?.token ?? null;

  const [regions, setRegions] = useState<RegionAdminSummary[]>([]);
  const [providers, setProviders] = useState<UtilityProviderAdminSummary[]>([]);
  const [regionsById, setRegionsById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editingRegion, setEditingRegion] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const [regionsData, providersData] = await Promise.all([
        api.get<RegionAdminSummary[]>("/admin/regions", token),
        api.get<UtilityProviderAdminSummary[]>("/admin/utility-providers", token),
      ]);
      setRegions(regionsData);
      setProviders(providersData);
      setRegionsById(Object.fromEntries(regionsData.map((r) => [r.region_id, r.region_name_el])));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <h1>{t("adminRegions.title")}</h1>

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <h2>{t("adminRegions.regionsHeading")}</h2>
        {regions.length === 0 ? (
          <p className={dashStyles.emptyState}>{t("adminRegions.empty")}</p>
        ) : (
          <table className={dashStyles.table}>
            <thead>
              <tr>
                <th>{tUpper("adminRegions.colRegion")}</th>
                <th>{tUpper("adminRegions.colYdom")}</th>
                <th>{tUpper("adminRegions.colPhone")}</th>
                <th>{tUpper("adminRegions.colEmail")}</th>
                <th>{tUpper("adminRegions.colStatus")}</th>
                <th>{tUpper("adminRegions.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) =>
                editingRegion === r.region_id ? (
                  <RegionEditRow
                    key={r.region_id}
                    region={r}
                    token={token}
                    onCancel={() => setEditingRegion(null)}
                    onSaved={() => {
                      setEditingRegion(null);
                      refresh();
                    }}
                  />
                ) : (
                  <tr key={r.region_id}>
                    <td>{r.region_name_el}</td>
                    <td>{r.ydom_authority_name ?? <span className="text-muted">{t("adminRegions.notSet")}</span>}</td>
                    <td>{r.contact_phone ?? <span className="text-muted">{t("adminRegions.notSet")}</span>}</td>
                    <td>{r.contact_email ?? <span className="text-muted">{t("adminRegions.notSet")}</span>}</td>
                    <td>
                      <span className={`badge ${r.status === "active" ? "badge-success" : "badge-warning"}`}>{r.status}</span>
                    </td>
                    <td>
                      <button className="btn btn-secondary" onClick={() => setEditingRegion(r.region_id)}>
                        {t("adminRegions.edit")}
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </section>

      <section className={`card ${dashStyles.section}`} style={{ marginTop: "var(--space-4)" }}>
        <h2>{t("adminRegions.providersHeading")}</h2>
        {providers.length === 0 ? (
          <p className={dashStyles.emptyState}>{t("adminRegions.empty")}</p>
        ) : (
          <table className={dashStyles.table}>
            <thead>
              <tr>
                <th>{tUpper("adminRegions.colProvider")}</th>
                <th>{tUpper("adminRegions.colType")}</th>
                <th>{tUpper("adminRegions.colCoverage")}</th>
                <th>{tUpper("adminRegions.colPhone")}</th>
                <th>{tUpper("adminRegions.colEmail")}</th>
                <th>{tUpper("adminRegions.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) =>
                editingProvider === p.provider_id ? (
                  <ProviderEditRow
                    key={p.provider_id}
                    provider={p}
                    token={token}
                    onCancel={() => setEditingProvider(null)}
                    onSaved={() => {
                      setEditingProvider(null);
                      refresh();
                    }}
                  />
                ) : (
                  <tr key={p.provider_id}>
                    <td>{p.provider_name}</td>
                    <td>
                      <ProviderTypeBadge providerType={p.provider_type}>
                        {p.provider_type === "water" ? t("adminRegions.typeWater") : t("adminRegions.typeElectric")}
                      </ProviderTypeBadge>
                    </td>
                    <td>{p.coverage_region_ids.map((id) => regionsById[id] ?? id).join(", ") || "—"}</td>
                    <td>{p.contact_phone ?? <span className="text-muted">{t("adminRegions.notSet")}</span>}</td>
                    <td>{p.contact_email ?? <span className="text-muted">{t("adminRegions.notSet")}</span>}</td>
                    <td>
                      <button className="btn btn-secondary" onClick={() => setEditingProvider(p.provider_id)}>
                        {t("adminRegions.edit")}
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function RegionEditRow({
  region,
  token,
  onCancel,
  onSaved,
}: {
  region: RegionAdminSummary;
  token: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [ydom, setYdom] = useState(region.ydom_authority_name ?? "");
  const [phone, setPhone] = useState(region.contact_phone ?? "");
  const [email, setEmail] = useState(region.contact_email ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      await api.patch(
        `/admin/regions/${region.region_id}`,
        {
          ydom_authority_name: ydom || null,
          contact_phone: phone || null,
          contact_email: email || null,
        },
        token
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={6}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap", padding: "var(--space-2) 0" }}>
          <strong style={{ marginRight: "var(--space-2)" }}>{region.region_name_el}</strong>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            {t("adminRegions.colYdom")}
            <input className="input" value={ydom} onChange={(e) => setYdom(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            {t("adminRegions.colPhone")}
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            {t("adminRegions.colEmail")}
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            {t("adminRegions.cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {t("adminRegions.save")}
          </button>
        </div>
      </td>
    </tr>
  );
}

function ProviderEditRow({
  provider,
  token,
  onCancel,
  onSaved,
}: {
  provider: UtilityProviderAdminSummary;
  token: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(provider.provider_name);
  const [phone, setPhone] = useState(provider.contact_phone ?? "");
  const [email, setEmail] = useState(provider.contact_email ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      await api.patch(
        `/admin/utility-providers/${provider.provider_id}`,
        {
          provider_name: name || null,
          contact_phone: phone || null,
          contact_email: email || null,
        },
        token
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={6}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap", padding: "var(--space-2) 0" }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            {t("adminRegions.colProvider")}
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            {t("adminRegions.colPhone")}
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            {t("adminRegions.colEmail")}
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            {t("adminRegions.cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {t("adminRegions.save")}
          </button>
        </div>
      </td>
    </tr>
  );
}

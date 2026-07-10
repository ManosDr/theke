"use client";

import L from "leaflet";
import { useEffect, useState, type ReactNode } from "react";
import { MapContainer, Marker, Polygon, Popup, TileLayer, WMSTileLayer, useMap, useMapEvents } from "react-leaflet";

import { api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import type { GeocodeResult, ParcelLookupResponse } from "../lib/types";
import styles from "./MapPicker.module.css";

// Kavala city center - a reasonable default view for a construction-vertical
// map that has no location yet, since that's this product's anchor region.
const DEFAULT_CENTER: [number, number] = [40.9397, 24.4132];

// GIS Phase 0 confirmed this WMS is live (single "BASEMAP" orthophoto
// layer); the cadastral-parcel WMS/WFS at a similar-looking URL is
// confirmed dead (404) - see KNOWN_DECISIONS.md - so only the aerial
// overlay is wired here, not a "Κτηματολόγιο" toggle.
const AERIAL_WMS_URL = "http://gis.ktimanet.gr/wms/wmsopen/wmsserver.aspx";

export type PinState = "idle" | "loading" | "resolved" | "archaeological" | "partial";

// Icon+color+text pairing, never color alone (per design spec): each state
// gets a distinct glyph, not just a different color.
function pinIcon(state: PinState): L.DivIcon {
  const glyph: Record<Exclude<PinState, "idle">, string> = {
    loading: "",
    resolved: "&#10003;",
    archaeological: "&#9888;",
    partial: "?",
  };
  const color: Record<Exclude<PinState, "idle">, string> = {
    loading: "var(--color-primary)",
    resolved: "var(--color-primary)",
    archaeological: "var(--color-warning)",
    partial: "var(--color-text-muted)",
  };
  const key = state === "idle" ? "resolved" : state;
  const spin = state === "loading" ? `${styles.pinSpin}` : "";

  return L.divIcon({
    className: styles.pinIconWrapper,
    html: `<div class="${styles.pin} ${spin}" style="background:${color[key]}">${glyph[key]}</div><div class="${styles.pinTail}" style="border-top-color:${color[key]}"></div>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -38],
  });
}

function ClickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// react-leaflet's MapContainer center/zoom props are mount-only - they
// don't reactively re-center the view on change. A manual pin click never
// needed this (the clicked point is already on-screen by definition), but a
// KAEK/address search result can be anywhere, so it needs an imperative
// fly-to. `flyToken` forces the effect to re-run even if the same
// coordinates are searched twice in a row.
function FlyToLocation({ lat, lon, zoom, flyToken }: { lat: number; lon: number; zoom: number; flyToken: number }) {
  const map = useMap();
  useEffect(() => {
    if (flyToken > 0) map.setView([lat, lon], zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToken]);
  return null;
}

interface MapPickerProps {
  lat: number | null;
  lon: number | null;
  pinState?: PinState;
  // kaek is only passed when the pin came from a KAEK search (not a plain
  // map click) - callers thread it into the resolve-location request so the
  // parcel data already fetched here (area, geometry, ktimatologio link)
  // isn't dropped on the floor when the location gets saved.
  onPick: (lat: number, lon: number, kaek?: string) => void;
  popupContent?: ReactNode;
  height?: number;
  // Enables the KAEK/address search fields - omitted (or null) in read-only
  // contexts where there's no meaningful token to authenticate the lookup
  // with.
  token?: string | null;
}

export default function MapPicker({
  lat,
  lon,
  pinState = "resolved",
  onPick,
  popupContent,
  height = 320,
  token = null,
}: MapPickerProps) {
  const { t } = useLocale();
  const [showAerial, setShowAerial] = useState(false);

  const [kaekQuery, setKaekQuery] = useState("");
  const [kaekSearching, setKaekSearching] = useState(false);
  const [kaekError, setKaekError] = useState<string | null>(null);
  const [parcelBoundary, setParcelBoundary] = useState<[number, number][] | null>(null);
  const [ktimatologioLink, setKtimatologioLink] = useState<string | null>(null);

  const [addressQuery, setAddressQuery] = useState("");
  const [addressSearching, setAddressSearching] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressResults, setAddressResults] = useState<GeocodeResult[]>([]);

  const [flyTarget, setFlyTarget] = useState<{ lat: number; lon: number; token: number } | null>(null);

  // A second location method firing after coordinates are already resolved
  // doesn't overwrite silently - it's queued here and only runs once the
  // user confirms. Native window.confirm() is deliberately not used (see
  // KNOWN_DECISIONS.md / the DocumentsPanel fix this session that replaced
  // it everywhere else in the app) - it blocks the JS thread and can't be
  // driven by browser automation tooling.
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const hasPin = lat != null && lon != null;
  const center: [number, number] = hasPin ? [lat, lon] : DEFAULT_CENTER;

  function runOrConfirm(action: () => void) {
    if (hasPin) {
      setPendingAction(() => action);
    } else {
      action();
    }
  }

  async function doSearchKaek() {
    // Normalise before building the URL rather than relying on
    // encodeURIComponent - a KAEK like "210183315011/0/0" would become
    // "210183315011%2F0%2F0", and whether an ASGI server decodes %2F back
    // into a literal path separator before route matching is inconsistent
    // across servers. Stripping the suffix client-side (matching the same
    // normalisation lookup_cadastral_parcel() does server-side) sidesteps
    // the ambiguity entirely.
    const query = kaekQuery.trim().split("/")[0].trim();
    if (!token || !query) return;
    setKaekSearching(true);
    setKaekError(null);
    setAddressError(null);
    setParcelBoundary(null);
    setKtimatologioLink(null);
    try {
      const result = await api.get<ParcelLookupResponse>(`/gis/parcel/${encodeURIComponent(query)}`, token);
      if (!result.available) {
        setKaekError(t("map.kaekServiceUnavailable"));
        return;
      }
      if (!result.found || result.centroid_lat == null || result.centroid_lon == null) {
        setKaekError(t("map.kaekNotFound"));
        return;
      }
      if (result.geometry?.coordinates?.[0]) {
        // GeoJSON is [lon, lat] per point - Leaflet's Polygon wants [lat, lon].
        setParcelBoundary(result.geometry.coordinates[0].map(([lonV, latV]) => [latV, lonV]));
      }
      setKtimatologioLink(result.ktimatologio_link ?? null);
      setFlyTarget({ lat: result.centroid_lat, lon: result.centroid_lon, token: Date.now() });
      onPick(result.centroid_lat, result.centroid_lon, result.kaek);
    } catch {
      setKaekError(t("map.kaekServiceUnavailable"));
    } finally {
      setKaekSearching(false);
    }
  }

  function searchKaek() {
    runOrConfirm(doSearchKaek);
  }

  async function doSearchAddress() {
    const query = addressQuery.trim();
    if (!token || !query) return;
    setAddressSearching(true);
    setAddressError(null);
    setKaekError(null);
    try {
      const results = await api.get<GeocodeResult[]>(`/gis/geocode?q=${encodeURIComponent(query)}`, token);
      if (results.length === 0) {
        setAddressError(t("map.addressNotFound"));
        setAddressResults([]);
        return;
      }
      setAddressResults(results);
    } catch {
      setAddressError(t("map.addressServiceUnavailable"));
      setAddressResults([]);
    } finally {
      setAddressSearching(false);
    }
  }

  function searchAddress() {
    runOrConfirm(doSearchAddress);
  }

  function selectAddressResult(result: GeocodeResult) {
    function apply() {
      setAddressResults([]);
      setParcelBoundary(null);
      setKtimatologioLink(null);
      setFlyTarget({ lat: result.lat, lon: result.lon, token: Date.now() });
      onPick(result.lat, result.lon);
    }
    // Selecting a dropdown result is itself the second step of an
    // already-confirmed address search, so it shouldn't re-prompt - only
    // the initial searchAddress() (or a KAEK search, or a map click) can
    // trigger the replace-confirmation.
    apply();
  }

  function handleMapClick(clickLat: number, clickLon: number) {
    runOrConfirm(() => onPick(clickLat, clickLon));
  }

  return (
    <div>
      <div className={styles.locationMethod}>
        <span className={styles.methodLabel}>{t("map.methodKaek")}</span>
        <div className={styles.methodRow}>
          <input
            type="text"
            className={`input ${styles.methodInput}`}
            placeholder={t("map.kaekSearchPlaceholder")}
            value={kaekQuery}
            onChange={(e) => setKaekQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchKaek();
              }
            }}
            disabled={!token || kaekSearching}
            title={token ? undefined : t("map.kaekSearchUnavailable")}
          />
          <button type="button" className="btn btn-secondary" onClick={searchKaek} disabled={!token || kaekSearching}>
            {t("map.search")}
          </button>
        </div>
        {token && (
          <div className={styles.methodMeta}>
            <span className={styles.kaekHint}>{t("map.kaekFormatHint")}</span>
            {kaekError && <span className={styles.kaekErrorText}>{kaekError}</span>}
            {ktimatologioLink && (
              <a href={ktimatologioLink} target="_blank" rel="noreferrer" className={styles.kaekLink}>
                {t("map.openInKtimatologio")}
              </a>
            )}
          </div>
        )}
      </div>

      <div className={styles.separator}>
        <span>{t("map.or")}</span>
      </div>

      <div className={styles.locationMethod}>
        <span className={styles.methodLabel}>{t("map.methodAddress")}</span>
        <div className={styles.methodRow}>
          <input
            type="text"
            className={`input ${styles.methodInput}`}
            placeholder={t("map.addressSearchPlaceholder")}
            value={addressQuery}
            onChange={(e) => setAddressQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchAddress();
              }
            }}
            disabled={!token || addressSearching}
            title={token ? undefined : t("map.kaekSearchUnavailable")}
          />
          <button type="button" className="btn btn-secondary" onClick={searchAddress} disabled={!token || addressSearching}>
            {t("map.search")}
          </button>
        </div>
        {addressError && <div className={styles.methodMeta}><span className={styles.kaekErrorText}>{addressError}</span></div>}
        {addressResults.length > 0 && (
          <div className={styles.addressDropdown}>
            {addressResults.map((result, i) => (
              <button
                type="button"
                key={i}
                className={styles.addressOption}
                onClick={() => selectAddressResult(result)}
              >
                <span className={styles.addressOptionName}>{result.display_name}</span>
                {result.type && <span className={styles.addressOptionType}>{result.type}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.separator}>
        <span>{t("map.or")}</span>
      </div>

      <div className={styles.locationMethod}>
        <div className={styles.methodRow}>
          <span className={styles.methodLabel}>{t("map.methodPin")}</span>
          <div className={styles.layerSwitcher}>
            <button
              type="button"
              className={!showAerial ? styles.layerButtonActive : styles.layerButton}
              onClick={() => setShowAerial(false)}
            >
              {t("map.layerRoad")}
            </button>
            <button
              type="button"
              className={showAerial ? styles.layerButtonActive : styles.layerButton}
              onClick={() => setShowAerial(true)}
            >
              {t("map.layerAerial")}
            </button>
          </div>
        </div>

        {pendingAction && (
          <div className={styles.confirmBanner}>
            <span>{t("map.confirmReplace")}</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                action();
              }}
            >
              {t("common.yes")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPendingAction(null)}>
              {t("common.cancel")}
            </button>
          </div>
        )}

        <div className={styles.mapWrapper} style={{ height }}>
          <MapContainer center={center} zoom={hasPin ? 17 : 13} style={{ height: "100%", width: "100%" }}>
            {showAerial ? (
              <WMSTileLayer url={AERIAL_WMS_URL} layers="BASEMAP" format="image/jpeg" attribution="&copy; Ktimatologio A.E." />
            ) : (
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            )}
            <ClickHandler onPick={handleMapClick} />
            {hasPin && (
              <Marker position={[lat, lon]} icon={pinIcon(pinState)}>
                {popupContent && <Popup className={styles.popup}>{popupContent}</Popup>}
              </Marker>
            )}
            {parcelBoundary && (
              <Polygon positions={parcelBoundary} pathOptions={{ color: "var(--color-primary)", weight: 2, fillOpacity: 0.15 }} />
            )}
            {flyTarget && <FlyToLocation lat={flyTarget.lat} lon={flyTarget.lon} zoom={18} flyToken={flyTarget.token} />}
          </MapContainer>
          {!hasPin && <div className={styles.instructionOverlay}>{t("map.clickInstruction")}</div>}
        </div>
      </div>
    </div>
  );
}

"use client";

import L from "leaflet";
import { useState, type ReactNode } from "react";
import { MapContainer, Marker, Popup, TileLayer, WMSTileLayer, useMapEvents } from "react-leaflet";

import { useLocale } from "../lib/i18n";
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

interface MapPickerProps {
  lat: number | null;
  lon: number | null;
  pinState?: PinState;
  onPick: (lat: number, lon: number) => void;
  popupContent?: ReactNode;
  height?: number;
}

export default function MapPicker({ lat, lon, pinState = "resolved", onPick, popupContent, height = 320 }: MapPickerProps) {
  const { t } = useLocale();
  const [showAerial, setShowAerial] = useState(false);
  const hasPin = lat != null && lon != null;
  const center: [number, number] = hasPin ? [lat, lon] : DEFAULT_CENTER;

  return (
    <div>
      <div className={styles.toolbar}>
        <input
          type="text"
          className={`input ${styles.kaekInput}`}
          placeholder={t("map.kaekSearchPlaceholder")}
          disabled
          title={t("map.kaekSearchUnavailable")}
        />
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
          <ClickHandler onPick={onPick} />
          {hasPin && (
            <Marker position={[lat, lon]} icon={pinIcon(pinState)}>
              {popupContent && <Popup className={styles.popup}>{popupContent}</Popup>}
            </Marker>
          )}
        </MapContainer>
        {!hasPin && <div className={styles.instructionOverlay}>{t("map.clickInstruction")}</div>}
      </div>
    </div>
  );
}

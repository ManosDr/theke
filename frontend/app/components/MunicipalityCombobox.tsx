"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import { CheckIcon, CloseIcon, WarningIcon } from "./UiIcons";
import type { RegionSummary } from "../lib/types";
import styles from "./MunicipalityCombobox.module.css";

const MAX_RESULTS = 60;

interface MunicipalityComboboxProps {
  regions: RegionSummary[];
  value: string;
  onChange: (regionId: string) => void;
  token: string | null;
  ariaInvalid?: boolean;
}

export default function MunicipalityCombobox({ regions, value, onChange, token, ariaInvalid }: MunicipalityComboboxProps) {
  const { t, tUpper } = useLocale();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [requestStatus, setRequestStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => regions.find((r) => r.region_id === value) ?? null, [regions, value]);

  // A fresh region pick always starts with an unsent request state - the
  // previous selection's "sent" confirmation shouldn't carry over and read
  // as if it applied to the newly picked region.
  useEffect(() => {
    setRequestStatus("idle");
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? regions.filter((r) => r.region_name_el.toLowerCase().includes(q) || r.region_name_en.toLowerCase().includes(q))
      : regions;
    // Covered regions surface first so a user who hasn't typed anything yet
    // sees real, useful options before scrolling past 300+ uncovered ones.
    const covered = matches.filter((r) => r.status === "active");
    const uncovered = matches.filter((r) => r.status !== "active");
    return { covered, uncovered, total: matches.length };
  }, [regions, query]);

  function select(region: RegionSummary) {
    onChange(region.region_id);
    setQuery("");
    setOpen(false);
  }

  function clearSelection() {
    onChange("");
    setQuery("");
  }

  async function requestCoverage() {
    if (!selected || !token) return;
    setRequestStatus("sending");
    try {
      await api.post(`/projects/regions/${selected.region_id}/request`, undefined, token);
      setRequestStatus("sent");
    } catch {
      setRequestStatus("error");
    }
  }

  function renderOption(r: RegionSummary) {
    return (
      <button type="button" key={r.region_id} className={styles.option} onClick={() => select(r)}>
        <span className={styles.optionName}>{r.region_name_el}</span>
        {r.status !== "active" && <span className={styles.uncoveredTag}>{t("municipality.uncoveredBadge")}</span>}
      </button>
    );
  }

  return (
    <div className={styles.container} ref={containerRef}>
      {!selected && (
        <>
          <input
            className="input"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={t("municipality.searchPlaceholder")}
            autoComplete="off"
            aria-invalid={!!ariaInvalid}
          />
          {open && (
            <div className={styles.dropdown}>
              {filtered.total === 0 && <p className={styles.emptyState}>{t("common.noMatches")}</p>}
              {filtered.covered.length > 0 && (
                <>
                  <div className={styles.groupHeading}>{tUpper("municipality.coveredGroupHeading")}</div>
                  {filtered.covered.slice(0, MAX_RESULTS).map(renderOption)}
                </>
              )}
              {filtered.uncovered.length > 0 && (
                <>
                  <div className={styles.groupHeading}>{tUpper("municipality.uncoveredGroupHeading")}</div>
                  {filtered.uncovered.slice(0, MAX_RESULTS).map(renderOption)}
                </>
              )}
            </div>
          )}
        </>
      )}

      {selected && (
        <div className={styles.selectedCard}>
          <div className={styles.selectedHeader}>
            <strong>{selected.region_name_el}</strong>
            <button type="button" className={styles.changeLink} onClick={clearSelection}>
              <CloseIcon size={12} />
              {t("municipality.change")}
            </button>
          </div>

          {selected.status !== "active" && (
            <div className={styles.uncoveredNotice}>
              <p className={styles.uncoveredHeadline}>
                <WarningIcon size={14} />
                {t("municipality.uncoveredBadge")}
              </p>
              <p className={styles.uncoveredMessage}>{t("municipality.expectationMessage", { region: selected.region_name_el })}</p>

              {requestStatus === "sent" ? (
                <p className={styles.requestSent}>
                  <CheckIcon size={13} />
                  {t("municipality.requestSent")}
                </p>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={requestCoverage}
                  disabled={requestStatus === "sending"}
                >
                  {requestStatus === "sending" ? t("municipality.requestSending") : t("municipality.requestCoverage")}
                </button>
              )}
              {requestStatus === "error" && <p className={styles.requestError}>{t("municipality.requestError")}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

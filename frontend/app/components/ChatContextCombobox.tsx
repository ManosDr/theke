"use client";

import { useEffect, useRef, useState } from "react";

import { useLocale } from "../lib/i18n";
import type { ProjectSummary, RegionSummary } from "../lib/types";
import styles from "./ChatContextCombobox.module.css";

interface ChatContextComboboxProps {
  projects: ProjectSummary[];
  regions: RegionSummary[];
  placeholder: string;
  // null means the user picked "Δημόσια βάση γνώσης" - the caller decides
  // what that means (switch the session's context, or clear the default
  // pin) since this component is reused for both, per its own docstring.
  onSelect: (project: ProjectSummary | null) => void;
}

function regionName(regions: RegionSummary[], regionId: string | null | undefined, locale: string): string | null {
  if (!regionId) return null;
  const r = regions.find((x) => x.region_id === regionId);
  if (!r) return null;
  return locale === "en" && r.region_name_en ? r.region_name_en : r.region_name_el;
}

function matchesQuery(p: ProjectSummary, regions: RegionSummary[], query: string): boolean {
  const q = query.toLocaleLowerCase("el");
  const fields = [p.name, p.municipality, p.customer_name, p.customer_afm, regionName(regions, p.region_id, "el")];
  return fields.some((f) => !!f && f.toLocaleLowerCase("el").includes(q));
}

// Single searchable combobox reused for two distinct actions in the chat
// context card (see chat/page.tsx): switching the current session's
// context, and picking a new default-project pin. Which one happens on
// selection is entirely up to the caller's onSelect - this component only
// knows how to search/display projects (and their linked customer, when
// one is set), it has no opinion on what a selection means. Deliberately
// stateless about "the current selection" - it always resets to an empty
// search box after a pick, since the two callers show "current" state
// differently (the pin status line vs the active chat thread itself).
export default function ChatContextCombobox({ projects, regions, placeholder, onSelect }: ChatContextComboboxProps) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const q = query.trim();
  const publicLabel = t("chat.context.publicOption");
  const showPublicOption =
    !q || publicLabel.toLocaleLowerCase(locale).includes(q.toLocaleLowerCase(locale)) || "public".startsWith(q.toLowerCase());
  const results = q ? projects.filter((p) => matchesQuery(p, regions, q)) : projects;

  function pick(project: ProjectSummary | null) {
    onSelect(project);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        className="input"
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className={styles.dropdown}>
          {showPublicOption && (
            <button type="button" className={styles.option} onClick={() => pick(null)}>
              <span className={styles.optionName}>{publicLabel}</span>
            </button>
          )}
          {results.map((p) => (
            <button type="button" key={p.id} className={styles.option} onClick={() => pick(p)}>
              <span className={styles.optionName}>{p.customer_name || p.name}</span>
              <span className={styles.optionMeta}>
                {p.customer_afm
                  ? `${t("customer.afmShort")} ${p.customer_afm}`
                  : regionName(regions, p.region_id, locale) || p.municipality || ""}
              </span>
            </button>
          ))}
          {results.length === 0 && !showPublicOption && <div className={styles.emptyOption}>{t("chat.context.noResults")}</div>}
        </div>
      )}
    </div>
  );
}

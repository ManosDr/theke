"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useLocale } from "../lib/i18n";
import type { ProjectSummary, RegionSummary } from "../lib/types";
import { SearchIcon } from "./NavIcons";
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
  // The dropdown is portaled to document.body (see render below) so its
  // results list is never a DOM descendant of whichever scrollable card
  // hosts this combobox - previously, being an absolutely-positioned
  // descendant still counted toward that ancestor's scrollable content
  // height, pushing a scrollbar onto the whole card instead of the
  // dropdown floating over the content below it. Both refs are checked for
  // outside-click since the portaled dropdown is no longer inside
  // containerRef's own subtree.
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const DROPDOWN_MAX_HEIGHT = 280;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < DROPDOWN_MAX_HEIGHT && rect.top > spaceBelow;
      setPosition({ top: openUp ? rect.top : rect.bottom, left: rect.left, width: rect.width, openUp });
    }
    reposition();
    // capture:true so scrolling inside ANY ancestor (the panel card, the
    // sheet, etc.) is caught here too - plain 'scroll' events don't bubble,
    // but a capture-phase listener on window still sees them fire on their
    // way down to the actual scrolled element.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

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
      <div className={styles.inputWrap}>
        <span className={styles.inputIcon}>
          <SearchIcon size={15} />
        </span>
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
      </div>
      {open &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            className={styles.dropdown}
            style={{
              position: "fixed",
              left: position.left,
              width: position.width,
              ...(position.openUp
                ? { bottom: window.innerHeight - position.top + 4, top: "auto" }
                : { top: position.top + 4, bottom: "auto" }),
            }}
          >
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
            {results.length === 0 && !showPublicOption && (
              <div className={styles.emptyOption}>{t("chat.context.noResults")}</div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

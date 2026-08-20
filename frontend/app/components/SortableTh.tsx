"use client";

import type { SortDirection } from "../lib/useSortableData";
import styles from "./SortableTh.module.css";

export function SortableTh({
  label,
  column,
  activeColumn,
  direction,
  onSort,
}: {
  label: string;
  column: string;
  activeColumn: string | null;
  direction: SortDirection;
  onSort: (column: string) => void;
}) {
  const active = activeColumn === column;
  const ariaSort = active ? (direction === "asc" ? "ascending" : "descending") : "none";

  return (
    <th aria-sort={ariaSort}>
      <SortToggleButton label={label} column={column} activeColumn={activeColumn} direction={direction} onSort={onSort} />
    </th>
  );
}

// Same clickable label + chevron as SortableTh, without the <th> wrapper -
// for card/grid screens (e.g. Data Sources) that have no table to hang a
// column header off of, but still want the one shared sort control rather
// than a bespoke variant.
export function SortToggleButton({
  label,
  column,
  activeColumn,
  direction,
  onSort,
  className,
}: {
  label: string;
  column: string;
  activeColumn: string | null;
  direction: SortDirection;
  onSort: (column: string) => void;
  className?: string;
}) {
  const active = activeColumn === column;
  return (
    <button
      type="button"
      className={`${styles.button} ${className ?? ""}`}
      aria-pressed={active}
      onClick={() => onSort(column)}
    >
      {label}
      <SortIcon active={active} direction={direction} />
    </button>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  const commonProps = {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (active && direction === "asc") {
    return (
      <svg {...commonProps} className={styles.iconActive} aria-hidden="true">
        <path d="M3 7l3-3 3 3" />
      </svg>
    );
  }
  if (active && direction === "desc") {
    return (
      <svg {...commonProps} className={styles.iconActive} aria-hidden="true">
        <path d="M3 5l3 3 3-3" />
      </svg>
    );
  }
  return (
    <svg {...commonProps} className={styles.icon} aria-hidden="true">
      <path d="M3 4.5l3-3 3 3" />
      <path d="M3 7.5l3 3 3-3" />
    </svg>
  );
}

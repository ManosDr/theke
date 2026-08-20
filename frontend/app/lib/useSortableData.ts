import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc" | null;

// Single shared sort behavior for every admin table (Item 3/4 audit found
// zero column-sorting anywhere in the app - this is the one pattern every
// screen now reuses instead of inventing its own). Three-click cycle:
// ascending -> descending -> back to unsorted/original order, matching the
// spec's "a third click returns to unsorted if that reads more naturally"
// - unsorted falls back to the data's original order (usually the API's own
// default, e.g. most-recent-first), which is a real, useful state to return
// to rather than an arbitrary one.
export function useSortState() {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  function toggleSort(column: string) {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else {
      setSortColumn(null);
      setSortDirection(null);
    }
  }

  return { sortColumn, sortDirection, toggleSort };
}

// Pure sort, exported standalone so screens with more than one independently
// rendered list (e.g. DataSourcesPanel's per-vertical groups) can apply the
// same sortColumn/sortDirection to each list separately without breaking
// their grouping - useSortableData below covers the common single-list case.
export function sortItems<T>(
  items: T[],
  sortColumn: string | null,
  sortDirection: SortDirection,
  getSortValue: (item: T, column: string) => string | number | null
): T[] {
  if (!sortColumn || !sortDirection) return items;
  const withValue = items.map((item, index) => ({ item, index, value: getSortValue(item, sortColumn) }));
  withValue.sort((a, b) => {
    // Nulls always sort last regardless of direction - a missing value
    // ("never verified", "—") isn't meaningfully "smallest"/"earliest",
    // so it shouldn't jump to the top on a descending sort.
    if (a.value == null && b.value == null) return a.index - b.index;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    let cmp: number;
    if (typeof a.value === "string" && typeof b.value === "string") {
      cmp = a.value.localeCompare(b.value, undefined, { sensitivity: "base" });
    } else {
      cmp = (a.value as number) - (b.value as number);
    }
    if (cmp === 0) return a.index - b.index; // stable tie-break
    return sortDirection === "asc" ? cmp : -cmp;
  });
  return withValue.map((w) => w.item);
}

export function useSortableData<T>(items: T[], getSortValue: (item: T, column: string) => string | number | null) {
  const { sortColumn, sortDirection, toggleSort } = useSortState();
  const sorted = useMemo(
    () => sortItems(items, sortColumn, sortDirection, getSortValue),
    [items, sortColumn, sortDirection, getSortValue]
  );
  return { sorted, sortColumn, sortDirection, toggleSort };
}

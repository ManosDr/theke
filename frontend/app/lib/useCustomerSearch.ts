import { useEffect, useState } from "react";

import { api } from "./api";
import type { CustomerSummary } from "./types";

// Extracted from CustomerCombobox.tsx so the project-creation combobox and
// the company admin's Πελάτες & Έργα list search box hit the exact same
// debounced call to GET /customers?q= (name/AFM prefix match, see
// backend/app/routers/customers.py's search_customers docstring) rather than
// each keeping its own copy of the debounce/cancellation logic.
export function useCustomerSearch(query: string, token: string | null, enabled: boolean): CustomerSummary[] {
  const [results, setResults] = useState<CustomerSummary[]>([]);

  useEffect(() => {
    if (!token || !enabled || query.trim().length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<CustomerSummary[]>(`/customers?q=${encodeURIComponent(query.trim())}`, token)
        .then((data) => {
          if (!cancelled) setResults(data);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, token, enabled]);

  return results;
}

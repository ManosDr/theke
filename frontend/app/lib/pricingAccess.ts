"use client";

import { useEffect, useState } from "react";

import { api } from "./api";
import { useAuth } from "./auth";
import type { SubscriptionStatusResponse } from "./types";

// There is no self-serve checkout (no Stripe) - a trial company visiting
// /pricing more than a few days before their trial actually ends can only
// be told "not yet, we'll be in touch", which is worse than not showing
// the page at all. Matches TrialBanner.tsx's own AMBER_THRESHOLD_DAYS - the
// same "late in trial" window, so the pricing page and the urgent countdown
// banner become reachable/visible at exactly the same point.
const LATE_TRIAL_THRESHOLD_DAYS = 7;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

// Real (non-trial) companies and logged-out visitors are always eligible.
// super_admin has no company to subscribe for and is gated separately
// (Sidebar hides the nav entry outright, PricingContent swaps CTAs for
// "Διαχείριση πλάνων" - neither of those is affected by this hook).
// Fails open (returns true) while loading or on a fetch error, so a
// transient network blip never locks a real paying customer out.
export function usePricingAccess(): boolean {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatusResponse | null>(null);

  const eligible = !!user && user.role !== "super_admin" && user.companyId != null;

  useEffect(() => {
    if (!eligible || !user) return;
    api
      .get<SubscriptionStatusResponse>("/subscription/status", user.token)
      .then(setStatus)
      .catch(() => setStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, user?.token]);

  if (!eligible) return true;
  if (!status || status.status !== "trial" || !status.trial_ends_at) return true;

  return daysUntil(status.trial_ends_at) <= LATE_TRIAL_THRESHOLD_DAYS;
}

import type { TranslationKey } from "./translations";
import type { SubscriptionStatusValue } from "./types";

export type AccountStatusTone = "badge-success" | "badge-warning" | "badge-danger";

export interface AccountStatusDisplay {
  text: string;
  badgeClass: AccountStatusTone;
}

// Single shared status→label mapping (Phase 4 of the beta/trial rollout) -
// reused by CompaniesPanel's list + detail modal and AdminUsersPanel, so
// "what does this status mean, and how urgent does it look" is defined in
// exactly one place instead of three slightly-different badge switches.
// is_suspended (a Company-level fact, not a CompanySubscription one - see
// KNOWN_DECISIONS.md) always wins: a suspended company reads as suspended
// regardless of whatever its underlying subscription status is.
export function accountStatusDisplay(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  params: { isSuspended: boolean; subscriptionStatus: SubscriptionStatusValue | null; trialEndsAt: string | null }
): AccountStatusDisplay {
  const { isSuspended, subscriptionStatus, trialEndsAt } = params;

  if (isSuspended) return { text: t("accountStatus.suspended"), badgeClass: "badge-danger" };

  switch (subscriptionStatus) {
    case "beta_pending":
      return { text: t("accountStatus.betaPending"), badgeClass: "badge-warning" };
    case "beta":
      return { text: t("accountStatus.beta"), badgeClass: "badge-success" };
    case "trial": {
      if (!trialEndsAt) return { text: t("accountStatus.trial"), badgeClass: "badge-warning" };
      const daysLeft = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000);
      return { text: t("accountStatus.trialDays", { days: Math.max(0, daysLeft) }), badgeClass: "badge-warning" };
    }
    case "active":
      return { text: t("accountStatus.active"), badgeClass: "badge-success" };
    case "expired":
      return { text: t("accountStatus.expired"), badgeClass: "badge-danger" };
    case "cancelled":
      return { text: t("accountStatus.cancelled"), badgeClass: "badge-danger" };
    case "rejected":
      return { text: t("accountStatus.rejected"), badgeClass: "badge-danger" };
    case "suspended":
      // Declared but never assigned anywhere in the app (see
      // KNOWN_DECISIONS.md) - handled defensively rather than falling
      // through to the null case below, in case that ever changes.
      return { text: t("accountStatus.suspended"), badgeClass: "badge-danger" };
    default:
      // subscription_status is null only for a company somehow missing its
      // CompanySubscription row - should be unreachable (see
      // CompanySummary.subscription_status's own docstring), but reads as
      // "active" rather than showing nothing.
      return { text: t("accountStatus.active"), badgeClass: "badge-success" };
  }
}

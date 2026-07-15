"use client";

import { useRouter } from "next/navigation";

import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import styles from "./TrialBanner.module.css";

// Shown whenever a super admin is viewing the app as another user (see
// auth.tsx's impersonateAsUser/stopImpersonating) - reuses TrialBanner's
// bar styling since both are the same "persistent status strip above the
// page content" shape, just with a different trigger and action.
export function ImpersonationBanner() {
  const { impersonating, stopImpersonating } = useAuth();
  const { t } = useLocale();
  const router = useRouter();

  if (!impersonating) return null;

  function handleReturn() {
    stopImpersonating();
    // The impersonated user's current page may not exist in the super
    // admin's own nav (e.g. /chat) - land somewhere valid for both.
    router.push("/admin/users");
  }

  return (
    <div className={styles.bar} data-level="amber" role="status">
      <span>{t("impersonation.banner")}</span>
      <button type="button" className={styles.viewPlansButton} onClick={handleReturn}>
        {t("impersonation.returnToAdmin")}
      </button>
    </div>
  );
}

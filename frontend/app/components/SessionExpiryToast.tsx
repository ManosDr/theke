"use client";

import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import { CloseIcon } from "./UiIcons";
import styles from "./SessionExpiryToast.module.css";

// Rendered inside LocaleProvider (see providers.tsx) so it can call
// useLocale() - the timer/state that decides *when* to show this lives in
// AuthProvider instead, which sits outside LocaleProvider in the tree.
export function SessionExpiryToast() {
  const { showSessionExpiryWarning, dismissSessionExpiryWarning } = useAuth();
  const { t } = useLocale();

  if (!showSessionExpiryWarning) return null;

  return (
    <div className={styles.toast} role="alert">
      <span>{t("common.sessionExpiryWarning")}</span>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reLoginButton}
          onClick={() => {
            window.open("/login", "_blank", "noopener,noreferrer");
            dismissSessionExpiryWarning();
          }}
        >
          {t("common.reLogin")}
        </button>
        <button
          type="button"
          className={styles.dismissButton}
          onClick={dismissSessionExpiryWarning}
          aria-label={t("common.dismiss")}
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}

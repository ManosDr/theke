"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import { CloseIcon } from "./UiIcons";
import styles from "./MessagePackUpsell.module.css";

const SHOWN_KEY = "theke-messagepack-upsell-shown";
const POOL_UPSELL_THRESHOLD = 0.8;

// The "πρόσθετο πακέτο (200 μηνύματα / €15 + ΦΠΑ)" line from terms.md §3.1,
// finally wired somewhere - previously existed only as legal copy with no
// UI ever pointing at it. Mounted next to the existing pool-usage
// indicators (chat header, company admin Συνδρομή tab) rather than as a
// global layout banner, since it's only relevant in the two places a user
// is already looking at their message usage.
//
// "Once per session, not every page load" is enforced by marking
// sessionStorage the moment it first becomes eligible to show - not only
// on explicit dismiss - so navigating away and back (or reloading) doesn't
// re-surface it while still >=80% used; that's the nagging this was meant
// to avoid. The X button lets a user close the current instance early.
export default function MessagePackUpsell({
  messagesUsed,
  messagesLimit,
  isBeta,
  token,
}: {
  messagesUsed: number;
  messagesLimit: number;
  isBeta: boolean;
  token: string | null;
}) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const pct = messagesUsed / Math.max(messagesLimit, 1);
    if (isBeta || pct < POOL_UPSELL_THRESHOLD) return;
    if (sessionStorage.getItem(SHOWN_KEY) === "true") return;
    sessionStorage.setItem(SHOWN_KEY, "true");
    setVisible(true);
  }, [isBeta, messagesUsed, messagesLimit]);

  if (!visible) return null;

  async function requestPack() {
    if (!token || requesting) return;
    setRequesting(true);
    try {
      await api.post("/subscription/message-pack-request", undefined, token);
      setSent(true);
    } catch {
      // Soft upsell, not a critical action - fail silently rather than
      // showing an error for a request the user can just try again later.
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className={styles.line} role="status">
      {sent ? (
        <span>{t("subscription.messagePackRequested")}</span>
      ) : (
        <>
          <span>{t("subscription.messagePackUpsell")}</span>
          <button type="button" className={styles.cta} onClick={requestPack} disabled={requesting}>
            {requesting ? t("common.loading") : t("subscription.messagePackCta")}
          </button>
        </>
      )}
      <button type="button" className={styles.dismiss} aria-label={t("common.dismiss")} onClick={() => setVisible(false)}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useLocale } from "../lib/i18n";
import styles from "./dashboard.module.css";
import welcomeStyles from "./WelcomeCard.module.css";

function dismissKey(companyId: number, userEmail: string): string {
  return `theke-welcome-dismissed-${companyId}-${userEmail}`;
}

// "Reappears next login if still empty" (Phase 2 onboarding spec) is
// approximated with sessionStorage, same as MessagePackUpsell's "once per
// session" - it clears on browser/tab restart but survives navigation
// within a session, so a dismiss doesn't come back on every page load.
export function WelcomeCard({
  companyId,
  userEmail,
  verticalSlug,
  verticalDisplayName,
  show,
}: {
  companyId: number;
  userEmail: string;
  verticalSlug: string;
  verticalDisplayName: string;
  show: boolean;
}) {
  const { t, locale } = useLocale();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(dismissKey(companyId, userEmail)) === "1");
  }, [companyId, userEmail]);

  if (!show || dismissed) return null;

  const isConstruction = verticalSlug === "construction";
  const isGreek = locale.startsWith("el");
  // The vertical's DB display name ("Θήκη Κατασκευαστικών") stays fully
  // Greek everywhere else per the brand-naming rule, but this specific
  // welcome-banner phrasing swaps only the fixed "Θήκη" prefix for the
  // indeclinable brand "Theke", keeping whatever modifier the DB defines.
  const modifier = verticalDisplayName.replace(/^Θήκη\s+/, "");
  const title = isGreek ? `Καλώς ήρθατε στη Theke ${modifier}` : t("dash.welcome.title");
  const body = isConstruction ? t("dash.welcome.bodyConstruction") : t("dash.welcome.bodyTax");
  const secondaryLabel = isConstruction ? t("dash.welcome.createProject") : t("dash.welcome.createClient");

  function dismiss() {
    sessionStorage.setItem(dismissKey(companyId, userEmail), "1");
    setDismissed(true);
  }

  return (
    <section className={`card ${styles.section} ${welcomeStyles.card}`}>
      <button
        type="button"
        className={welcomeStyles.dismiss}
        aria-label={t("common.dismiss")}
        onClick={dismiss}
      >
        ×
      </button>
      <h2>{title}</h2>
      <p className="text-muted">{body}</p>
      <div className={welcomeStyles.actions}>
        <Link href="/chat" className="btn btn-primary">
          {t("dash.welcome.startChat")}
        </Link>
        <Link href="/projects/new" className="btn btn-secondary">
          {secondaryLabel}
        </Link>
      </div>
      <Link href="/help" className={welcomeStyles.helpLink}>
        {t("dash.welcome.helpLink")}
      </Link>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";

import { useLocale } from "../lib/i18n";
import { DocumentsIcon } from "../components/NavIcons";
import { CloseIcon } from "../components/UiIcons";
import styles from "./dashboard.module.css";
import calloutStyles from "./DocUploadCallout.module.css";

function dismissKey(companyId: number, userEmail: string): string {
  return `theke-doc-upload-callout-dismissed-${companyId}-${userEmail}`;
}

// UX proposal Part 2 - purely behavioral, no new backend signal: fires once
// a company has created its second project (construction) or client (tax)
// with zero documents uploaded across all of them, per the UX reasoning
// that a brand-new user's first project/client already has a bigger risk
// to manage (their first question landing in a scope gap) and shouldn't be
// interrupted with a secondary feature pitch - by the second one, it's an
// established pattern worth naming. Permanent dismiss (localStorage, not
// WelcomeCard's sessionStorage) - once seen and closed, this doesn't come
// back on the next login, unlike the "reappears while still genuinely
// empty" welcome banner.
export function DocUploadCallout({
  companyId,
  userEmail,
  isTax,
  show,
}: {
  companyId: number;
  userEmail: string;
  isTax: boolean;
  show: boolean;
}) {
  const { t } = useLocale();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey(companyId, userEmail)) === "1");
  }, [companyId, userEmail]);

  if (!show || dismissed) return null;

  function dismiss() {
    localStorage.setItem(dismissKey(companyId, userEmail), "1");
    setDismissed(true);
  }

  return (
    <section className={`card ${styles.section} ${calloutStyles.card}`}>
      <span className={calloutStyles.icon} aria-hidden="true">
        <DocumentsIcon size={16} />
      </span>
      <p className={calloutStyles.body}>{t(isTax ? "dash.docUploadCallout.bodyTax" : "dash.docUploadCallout.bodyConstruction")}</p>
      <button type="button" className={calloutStyles.dismiss} aria-label={t("common.dismiss")} onClick={dismiss}>
        <CloseIcon size={16} />
      </button>
    </section>
  );
}

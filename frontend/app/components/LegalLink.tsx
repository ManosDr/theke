"use client";

import { useLocale } from "../lib/i18n";
import type { LegalDocSlug, LegalStatusResponse } from "../lib/types";
import styles from "./LegalFooter.module.css";

const DOC_LABEL_KEYS: Record<LegalDocSlug, "legal.terms" | "legal.privacy" | "legal.dpa"> = {
  terms: "legal.terms",
  privacy: "legal.privacy",
  dpa: "legal.dpa",
};

// Shared by the footer, the registration checkbox, and the Account page's
// "Νομικά" section - respects the draft gate everywhere a legal document is
// linked from, per Step 2: a draft document is shown disabled/labeled
// "(προσχέδιο)", never linked to directly. status is null while the
// /legal/status fetch is still in flight - treated as draft (the safer
// default) until it resolves, same reasoning as defaulting closed on an
// unresolved permission check.
export function LegalLink({
  slug,
  status,
  newTab = false,
  label: labelOverride,
}: {
  slug: LegalDocSlug;
  status: LegalStatusResponse | null;
  newTab?: boolean;
  // Overrides the default (nominative-case) document title - needed
  // inline in a sentence like "Αποδέχομαι τους Όρους Χρήσης..." where
  // Greek grammar wants a different case than the standalone title.
  label?: string;
}) {
  const { t } = useLocale();
  const label = labelOverride ?? t(DOC_LABEL_KEYS[slug]);
  const isDraft = status ? status[slug] : true;

  if (isDraft) {
    return (
      <span className={styles.draftLink} title={t("legal.draftHint")}>
        {label} ({t("legal.draftSuffix")})
      </span>
    );
  }
  return (
    <a href={`/${slug}`} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}>
      {label}
    </a>
  );
}

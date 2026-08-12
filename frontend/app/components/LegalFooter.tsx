"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { LegalLink } from "./LegalLink";
import type { LegalStatusResponse } from "../lib/types";
import styles from "./LegalFooter.module.css";

// theke.ai is the real, purchased domain (confirmed by the user directly,
// unlike the earlier theke.gr placeholder - see KNOWN_DECISIONS.md).
// info@theke.ai is the one real inbox currently provisioned - every public
// contact surface in the app points at it (see KNOWN_DECISIONS.md's email
// consolidation entry). No contact_email/support_email setting exists in
// config.py to read this from; kept as a literal here, same as gis.py's
// Nominatim user-agent.
const CONTACT_EMAIL = "info@theke.ai";

// Public-page-only footer (login, register, forgot/reset-password) - the
// authenticated app shell never renders this; the Account page's own
// "Νομικά" section covers the same links for logged-in users instead.
export function LegalFooter() {
  const [status, setStatus] = useState<LegalStatusResponse | null>(null);

  useEffect(() => {
    api
      .get<LegalStatusResponse>("/legal/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <span>© {year} Theke</span>
      <span className={styles.sep}>·</span>
      <LegalLink slug="terms" status={status} newTab />
      <span className={styles.sep}>·</span>
      <LegalLink slug="privacy" status={status} newTab />
      <span className={styles.sep}>·</span>
      <LegalLink slug="dpa" status={status} newTab />
      <span className={styles.sep}>·</span>
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </footer>
  );
}

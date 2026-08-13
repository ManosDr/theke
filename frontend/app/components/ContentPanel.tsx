"use client";

import { useState } from "react";

import { useLocale } from "../lib/i18n";
import { EmailTemplatesPanel } from "./EmailTemplatesPanel";
import { HelpSectionsPanel } from "./HelpSectionsPanel";
import { LegalDocumentsPanel } from "./LegalDocumentsPanel";
import styles from "./ContentPanel.module.css";

type Tab = "legal" | "email" | "help";

// Unifies what used to be three separate sidebar entries (Legal Documents,
// Email Templates, Help Sections) into one "Περιεχόμενο" location, following
// the same single-page/in-page-tabs convention SubscriptionsPanel already
// established for Εταιρείες/Πλάνα - not a nav sub-group, so there's no
// per-item icon to keep distinct. Each tab's panel component is unchanged;
// this is purely a grouping/navigation change.
export function ContentPanel() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("legal");

  return (
    <div>
      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "legal"}
          className={`${styles.tabButton} ${tab === "legal" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("legal")}
        >
          {t("adminContent.tabLegal")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "email"}
          className={`${styles.tabButton} ${tab === "email" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("email")}
        >
          {t("adminContent.tabEmail")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "help"}
          className={`${styles.tabButton} ${tab === "help" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("help")}
        >
          {t("adminContent.tabHelp")}
        </button>
      </div>

      {tab === "legal" && <LegalDocumentsPanel />}
      {tab === "email" && <EmailTemplatesPanel />}
      {tab === "help" && <HelpSectionsPanel />}
    </div>
  );
}

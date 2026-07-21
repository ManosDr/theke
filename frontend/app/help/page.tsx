"use client";

import { AppShell } from "../components/AppShell";
import { RequireAuth, useAuth } from "../lib/auth";
import { useCompany } from "../lib/company";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import styles from "./help.module.css";

interface HelpSection {
  key: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  noteKey?: TranslationKey;
}

function HelpContent() {
  const { user } = useAuth();
  const { company } = useCompany();
  const { t } = useLocale();

  const isConstruction = company ? company.vertical_slug === "construction" : true;
  const isAdmin = user?.role === "admin";
  const isSuperAdmin = user?.role === "super_admin";

  const sections: HelpSection[] = [
    {
      key: "chat",
      titleKey: "help.chatTitle",
      bodyKey: "help.chatBody",
      noteKey: isConstruction && !isSuperAdmin ? "help.chatConstructionNote" : undefined,
    },
  ];

  if (!isSuperAdmin) {
    sections.push({
      key: "project",
      titleKey: isConstruction ? "help.projectTitleConstruction" : "help.projectTitleTax",
      bodyKey: isConstruction ? "help.projectBodyConstruction" : "help.projectBodyTax",
    });
  }

  if (isAdmin) {
    sections.push(
      { key: "users", titleKey: "help.usersTitle", bodyKey: "help.usersBody" },
      { key: "usage", titleKey: "help.usageTitle", bodyKey: "help.usageBody" },
      { key: "subscription", titleKey: "help.subscriptionTitle", bodyKey: "help.subscriptionBody" }
    );
  }

  if (isSuperAdmin) {
    sections.push({ key: "platform", titleKey: "help.platformTitle", bodyKey: "help.platformBody" });
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1>{t("help.title")}</h1>
        <p className={styles.subtitle}>{t("help.subtitle")}</p>
      </div>

      {sections.map((section, i) => (
        <details key={section.key} className={`card ${styles.section}`} open={i === 0}>
          <summary className={styles.summary}>
            {t(section.titleKey)}
            <span className={styles.chevron} aria-hidden="true">
              ▸
            </span>
          </summary>
          <div className={styles.body}>
            {t(section.bodyKey)}
            {section.noteKey && `\n\n${t(section.noteKey)}`}
          </div>
        </details>
      ))}
    </div>
  );
}

export default function HelpPage() {
  return (
    <RequireAuth>
      <AppShell>
        <HelpContent />
      </AppShell>
    </RequireAuth>
  );
}

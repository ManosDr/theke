"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AppShell } from "../components/AppShell";
import { api } from "../lib/api";
import { RequireAuth, useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { HelpSectionPublic } from "../lib/types";
import styles from "./help.module.css";

function HelpContent() {
  const { user } = useAuth();
  const { locale, t } = useLocale();
  const [sections, setSections] = useState<HelpSectionPublic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.token) return;
    setLoading(true);
    api
      .get<HelpSectionPublic[]>(`/help-sections?locale=${locale}`, user.token)
      .then(setSections)
      .finally(() => setLoading(false));
  }, [user?.token, locale]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1>{t("help.title")}</h1>
        <p className={styles.subtitle}>{t("help.subtitle")}</p>
      </div>

      {loading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : (
        sections.map((section, i) => (
          <details key={section.id} className={`card ${styles.section}`} open={i === 0}>
            <summary className={styles.summary}>
              {section.title}
              <span className={styles.chevron} aria-hidden="true">
                ▸
              </span>
            </summary>
            <div className={styles.body}>
              <Markdown remarkPlugins={[remarkGfm]}>{section.body}</Markdown>
            </div>
          </details>
        ))
      )}
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

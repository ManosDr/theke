"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const targetSlug = searchParams.get("section");
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

  // Deep-link support (e.g. from the dashboard welcome card): scroll the
  // targeted section into view once its <details> element exists in the DOM.
  useEffect(() => {
    if (!targetSlug || loading) return;
    const el = document.getElementById(`help-section-${targetSlug}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [targetSlug, loading]);

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
          <details
            key={section.id}
            id={`help-section-${section.slug}`}
            className={`card ${styles.section}`}
            open={section.slug === targetSlug || (!targetSlug && i === 0)}
          >
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
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <HelpContent />
        </Suspense>
      </AppShell>
    </RequireAuth>
  );
}

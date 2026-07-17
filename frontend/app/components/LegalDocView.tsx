"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import type { LegalDocResponse, LegalDocSlug } from "../lib/types";
import styles from "./LegalDocView.module.css";

// Draft-state gate: GET /legal/{slug} itself never sends placeholder-laden
// content (see app/services/legal_docs.py) - is_draft here just decides
// which of the two render paths to take, it's not the thing keeping the
// text safe. This is what Step 2 of the spec means by "no manual step
// required to remember not to link them yet": the backend re-checks the
// source markdown on every request.
export function LegalDocView({ slug }: { slug: LegalDocSlug }) {
  const { t } = useLocale();
  const [doc, setDoc] = useState<LegalDocResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<LegalDocResponse>(`/legal/${slug}`)
      .then(setDoc)
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  if (!doc || doc.is_draft) {
    return (
      <div className={styles.draftBanner} role="status">
        <strong>{t("legal.draftBannerTitle")}</strong>
        <p>{t("legal.draftBannerBody")}</p>
      </div>
    );
  }

  return (
    <article className={styles.doc}>
      <Markdown remarkPlugins={[remarkGfm]}>{doc.content}</Markdown>
    </article>
  );
}

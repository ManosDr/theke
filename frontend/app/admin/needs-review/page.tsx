"use client";

import { AppShell } from "../../components/AppShell";
import { StaleDocumentsQueue } from "../../components/StaleDocumentsQueue";
import { RequireSuperAdmin } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";

export default function NeedsReviewPage() {
  const { t } = useLocale();
  return (
    <RequireSuperAdmin>
      <AppShell>
        <StaleDocumentsQueue title={t("admin.needsReview.title")} description={t("admin.needsReview.description")} />
      </AppShell>
    </RequireSuperAdmin>
  );
}

"use client";

import { AppShell } from "../../components/AppShell";
import { StaleDocumentsQueue } from "../../components/StaleDocumentsQueue";
import { RequireSuperAdmin } from "../../lib/auth";
import { useLocale } from "../../lib/i18n";

export default function StaleDocumentsPage() {
  const { t } = useLocale();
  return (
    <RequireSuperAdmin>
      <AppShell>
        <StaleDocumentsQueue title={t("admin.staleDocuments.title")} description={t("admin.staleDocuments.description")} />
      </AppShell>
    </RequireSuperAdmin>
  );
}

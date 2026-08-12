"use client";

import { AppShell } from "../../components/AppShell";
import { LegalDocumentsPanel } from "../../components/LegalDocumentsPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminLegalDocumentsPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <LegalDocumentsPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

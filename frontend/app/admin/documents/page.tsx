"use client";

import { AppShell } from "../../components/AppShell";
import { DocumentsPanel } from "../../components/DocumentsPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminDocumentsPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <DocumentsPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

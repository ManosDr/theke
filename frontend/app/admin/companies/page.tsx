"use client";

import { AppShell } from "../../components/AppShell";
import { CompaniesPanel } from "../../components/CompaniesPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminCompaniesPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <CompaniesPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

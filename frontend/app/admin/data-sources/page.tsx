"use client";

import { AppShell } from "../../components/AppShell";
import { DataSourcesPanel } from "../../components/DataSourcesPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminDataSourcesPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <DataSourcesPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

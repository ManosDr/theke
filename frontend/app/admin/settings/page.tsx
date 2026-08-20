"use client";

import { AppShell } from "../../components/AppShell";
import { SystemSettingsPanel } from "../../components/SystemSettingsPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminSettingsPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <SystemSettingsPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

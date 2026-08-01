"use client";

import { AppShell } from "../../components/AppShell";
import { SpendAlertsPanel } from "../../components/SpendAlertsPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function SpendAlertsPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <SpendAlertsPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

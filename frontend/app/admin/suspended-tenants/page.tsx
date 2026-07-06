"use client";

import { AppShell } from "../../components/AppShell";
import { SuspendedTenantsPanel } from "../../components/SuspendedTenantsPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function SuspendedTenantsPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <SuspendedTenantsPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

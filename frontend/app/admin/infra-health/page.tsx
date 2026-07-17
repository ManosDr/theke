"use client";

import { AppShell } from "../../components/AppShell";
import { InfraHealthPanel } from "../../components/InfraHealthPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function InfraHealthPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <InfraHealthPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

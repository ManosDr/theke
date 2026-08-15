"use client";

import { AppShell } from "../../components/AppShell";
import { BusinessHealthPanel } from "../../components/BusinessHealthPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function BusinessHealthPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <BusinessHealthPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

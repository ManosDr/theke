"use client";

import { AppShell } from "../../components/AppShell";
import { InternalActivityPanel } from "../../components/InternalActivityPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function InternalActivityPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <InternalActivityPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

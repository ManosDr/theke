"use client";

import { AppShell } from "../../components/AppShell";
import { RegionsProvidersPanel } from "../../components/RegionsProvidersPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminRegionsPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <RegionsProvidersPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

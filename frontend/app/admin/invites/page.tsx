"use client";

import { AppShell } from "../../components/AppShell";
import { AdminInvitesPanel } from "../../components/AdminInvitesPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminInvitesPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <AdminInvitesPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

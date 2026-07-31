"use client";

import { AppShell } from "../../components/AppShell";
import { AuditLogPanel } from "../../components/AuditLogPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AuditLogPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <AuditLogPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

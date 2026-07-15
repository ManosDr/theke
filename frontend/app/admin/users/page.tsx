"use client";

import { AppShell } from "../../components/AppShell";
import { AdminUsersPanel } from "../../components/AdminUsersPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminUsersPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <AdminUsersPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

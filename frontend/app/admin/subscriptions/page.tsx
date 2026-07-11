"use client";

import { AppShell } from "../../components/AppShell";
import { SubscriptionsPanel } from "../../components/SubscriptionsPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminSubscriptionsPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <SubscriptionsPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

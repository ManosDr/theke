"use client";

import { AppShell } from "../../components/AppShell";
import { WeeklyDigestPanel } from "../../components/WeeklyDigestPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function WeeklyDigestPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <WeeklyDigestPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

"use client";

import { AppShell } from "../../components/AppShell";
import { ContentPanel } from "../../components/ContentPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminContentPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <ContentPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

"use client";

import { AppShell } from "../../components/AppShell";
import { VerticalEditorPanel } from "../../components/VerticalEditorPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminVerticalsPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <VerticalEditorPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

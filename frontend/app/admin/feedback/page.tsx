"use client";

import { AppShell } from "../../components/AppShell";
import { FeedbackPanel } from "../../components/FeedbackPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminFeedbackPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <FeedbackPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

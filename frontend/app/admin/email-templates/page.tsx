"use client";

import { AppShell } from "../../components/AppShell";
import { EmailTemplatesPanel } from "../../components/EmailTemplatesPanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function AdminEmailTemplatesPage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <EmailTemplatesPanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

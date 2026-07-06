"use client";

import { AppShell } from "../../components/AppShell";
import { ChatGapRatePanel } from "../../components/ChatGapRatePanel";
import { RequireSuperAdmin } from "../../lib/auth";

export default function ChatGapRatePage() {
  return (
    <RequireSuperAdmin>
      <AppShell>
        <ChatGapRatePanel />
      </AppShell>
    </RequireSuperAdmin>
  );
}

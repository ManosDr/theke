"use client";

import { AppShell } from "../components/AppShell";
import { RequireAuth, useAuth } from "../lib/auth";
import { CompanyAdminDashboard } from "./CompanyAdminDashboard";
import { MemberDashboard } from "./MemberDashboard";
import { SuperAdminDashboard } from "./SuperAdminDashboard";

function DashboardContent() {
  const { user } = useAuth();

  if (!user) return null;
  if (user.role === "super_admin") return <SuperAdminDashboard />;
  if (user.role === "admin") return <CompanyAdminDashboard />;
  return <MemberDashboard />;
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <AppShell>
        <DashboardContent />
      </AppShell>
    </RequireAuth>
  );
}

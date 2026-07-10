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

function DashboardShell() {
  const { user } = useAuth();
  return (
    <AppShell fullWidth={user?.role === "admin"}>
      <DashboardContent />
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardShell />
    </RequireAuth>
  );
}

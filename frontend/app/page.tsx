"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { LandingPage } from "./components/LandingPage";
import { useAuth } from "./lib/auth";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Logged-in visitors still go straight to the app - only a logged-out "/"
  // gets the marketing page now (see LandingPage.tsx).
  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/dashboard");
  }, [user, loading, router]);

  if (loading || user) return null;
  return <LandingPage />;
}

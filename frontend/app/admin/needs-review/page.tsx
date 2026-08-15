"use client";

import { redirect } from "next/navigation";

// See admin/stale-documents/page.tsx's comment - same redirect, same reason
// (this route showed the identical, now-removed read-only queue).
export default function NeedsReviewPage() {
  redirect("/admin/documents?needs_review_only=true");
}

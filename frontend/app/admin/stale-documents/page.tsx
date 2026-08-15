"use client";

import { redirect } from "next/navigation";

// This screen's dedicated read-only queue (StaleDocumentsQueue) was
// removed - it only let a reviewer blindly confirm a flagged document
// without any way to read its content or see why the AI flagged it. The
// real reviewing UI (revalidate panel: reasoning, current vs. suggested
// content, accept/edit/dismiss) already existed at /admin/documents;
// redirecting here instead of duplicating it, with the needs-review filter
// pre-applied so this route still lands on the same set of documents.
export default function StaleDocumentsPage() {
  redirect("/admin/documents?needs_review_only=true");
}

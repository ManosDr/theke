"""Weekly data retention/deletion sweep (see crawler/crontab) - the
enforcement half of Phase 0's compliance work; POST /account/request-
deletion only sets the clock, this job is what actually deletes anything.

Retention rules (legal review, not placeholders - see KNOWN_DECISIONS.md):
  - On cancellation (company_subscriptions.cancelled_at set): chat history
    and uploaded documents survive 60 days (in case of reactivation), then
    hard-delete.
  - On an explicit deletion request (companies.deletion_requested_at set,
    from POST /account/request-deletion): chat history, documents, AND
    account/profile data hard-delete within 30 days of the request -
    this ALWAYS overrides the 60-day cancellation window, whether or not
    the company was ever cancelled at all (see _compute_deadline below,
    the one place this precedence is encoded).
  - Billing/invoice records are excluded from all of the above, always -
    this file never imports, queries, or references the `invoices` table
    anywhere, by construction, so "the job forgot a WHERE clause" isn't a
    failure mode that can happen here. Retained per Greek statutory
    requirement (5 years) regardless of what happens to the rest of a
    company's data.

The companies ROW ITSELF is never deleted, even on a full deletion request.
invoices.company_id is a NOT NULL FK straight to companies(id) with no
ON DELETE clause (by design - see Phase 0.5's schema comment) precisely
because a company's invoice history must outlive the company deleting its
account. Deleting the row would either violate that FK (if any invoice
exists) or silently orphan the invoice's legal audit trail (if allowed via
CASCADE, which it isn't). Instead, a full deletion scrubs every PII-bearing
column on the row directly (name, logo_path, legal_name, afm,
billing_address) and deletes every users row that pointed at it - the
company becomes an anonymized stub, exactly as far as GDPR erasure
requires, without breaking the one thing that must never break.
"""

import os
from datetime import datetime, timedelta

import psycopg

from crawler.config import DATABASE_URL

# Must match backend/app/services/documents.py's UPLOAD_DIR exactly - this
# job runs in the `scheduler` container, a separate deployable from
# `backend`, so it can't import that module directly (see
# canary_benchmark.py's docstring on the same constraint). Requires
# `scheduler` to mount the same `uploads_data` volume backend does (see
# docker-compose.yml) - without that mount this constant would point at an
# empty directory in this container and every os.remove() below would
# silently no-op via the FileNotFoundError catch, deleting DB rows without
# ever freeing the actual files. Deliberately not swallowed silently:
# _delete_company_files logs a warning per miss so that failure mode is at
# least visible in `docker logs`, even though nothing here treats it as
# fatal (a file-system inconsistency shouldn't block the DB-level compliance
# deletion, which is the legally load-bearing part).
UPLOAD_DIR = "/app/uploads"


def _compute_deadline(deletion_requested_at: datetime | None, cancelled_at: datetime | None) -> datetime | None:
    """The exact precedence rule from the retention spec: an explicit
    deletion request ALWAYS overrides the cancellation window, regardless of
    which one is earlier/later or whether the company is even cancelled at
    all. A request on day 10 of an existing 60-day cancellation window must
    complete by day 40 (30 days from the request) - not day 60."""
    if deletion_requested_at is not None:
        return deletion_requested_at + timedelta(days=30)
    if cancelled_at is not None:
        return cancelled_at + timedelta(days=60)
    return None


def _delete_company_files(conn: psycopg.Connection, company_id: int) -> int:
    """Removes the on-disk PDF for every document this company owns, before
    the DB rows are deleted (once the row is gone there's no way to look up
    the path again). Returns how many files were actually removed, for the
    run summary. Only ever touches paths under UPLOAD_DIR - a document row
    with company_id set is always a company upload per the schema (see
    db/init.sql's documents comment), so `source` is always a real on-disk
    path here, never a crawled URL, but the prefix check costs nothing and
    means a future data shape this code wasn't written for fails safe
    (skip + warn) instead of calling os.remove() on something unexpected."""
    removed = 0
    with conn.cursor() as cur:
        cur.execute("SELECT source FROM documents WHERE company_id = %s AND source IS NOT NULL", (company_id,))
        paths = [row[0] for row in cur.fetchall()]
    for path in paths:
        if not path.startswith(UPLOAD_DIR):
            print(f"  WARNING: document source '{path}' is outside UPLOAD_DIR, not removing")
            continue
        try:
            os.remove(path)
            removed += 1
        except FileNotFoundError:
            pass  # already gone (or the volume mount is missing - see module docstring)
        except OSError as exc:
            print(f"  WARNING: failed to remove '{path}': {exc}")
    return removed


def _delete_company_content(conn: psycopg.Connection, company_id: int) -> None:
    """Chat history + documents (and everything that references them) -
    the part of the job that runs for EVERY company that's past its
    deadline, full deletion or not. Ordered to never violate a FK: children
    before parents, and any nullable FK pointing at a row we're about to
    delete gets nulled out first rather than left to error."""
    with conn.cursor() as cur:
        # chat_sessions and everything that references one
        cur.execute(
            "DELETE FROM message_feedback WHERE session_id IN (SELECT id FROM chat_sessions WHERE company_id = %s)",
            (company_id,),
        )
        cur.execute(
            "UPDATE benchmark_alerts SET session_id = NULL "
            "WHERE session_id IN (SELECT id FROM chat_sessions WHERE company_id = %s)",
            (company_id,),
        )
        cur.execute("DELETE FROM chat_sessions WHERE company_id = %s", (company_id,))

        # documents and everything that references one (embeddings cascade
        # automatically - see db/init.sql's `ON DELETE CASCADE` on
        # embeddings.document_id)
        # document_removal_requests/document_validations for documents this
        # company itself owns - requested_by/decided_by/validated_by always
        # point at a user of the SAME company as the document in this app's
        # actual usage (removal requests and revalidation are both scoped to
        # one company's own KB, see app/routers/admin.py), so deleting these
        # rows outright (rather than nulling a user reference) never orphans
        # a cross-company record. The reverse case - a user at THIS company
        # having validated/decided something for ANOTHER company's document
        # - is handled separately in _delete_company_account, right before
        # that company's users are deleted.
        cur.execute(
            "DELETE FROM document_removal_requests WHERE document_id IN (SELECT id FROM documents WHERE company_id = %s)",
            (company_id,),
        )
        cur.execute(
            "DELETE FROM document_validations WHERE document_id IN (SELECT id FROM documents WHERE company_id = %s)",
            (company_id,),
        )
        cur.execute(
            "UPDATE documents SET replaces_document_id = NULL "
            "WHERE replaces_document_id IN (SELECT id FROM documents WHERE company_id = %s)",
            (company_id,),
        )
        cur.execute("DELETE FROM documents WHERE company_id = %s", (company_id,))

        # projects/customers - deleted for every past-deadline company, not
        # only full-deletion ones, since they're operational data tied to
        # the same chat/documents lifecycle, not account/profile data
        cur.execute(
            "DELETE FROM user_default_projects WHERE project_id IN (SELECT id FROM projects WHERE company_id = %s)",
            (company_id,),
        )
        cur.execute("DELETE FROM projects WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM customers WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM subscription_usage WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM company_subscriptions WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM user_feedback WHERE company_id = %s", (company_id,))


def _delete_company_account(conn: psycopg.Connection, company_id: int) -> None:
    """Only called when deletion_requested_at is set (a full deletion, not
    just the 60-day post-cancellation content purge). Deletes every user at
    the company and anonymizes the companies row itself - never DELETEs the
    companies row (see module docstring: invoices.company_id would either
    block it or, worse, orphan a statutory record)."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = %s)",
            (company_id,),
        )
        cur.execute(
            "DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE company_id = %s)", (company_id,)
        )
        cur.execute("DELETE FROM invites WHERE company_id = %s", (company_id,))
        cur.execute(
            "UPDATE audit_log SET actor_user_id = NULL WHERE actor_user_id IN (SELECT id FROM users WHERE company_id = %s)",
            (company_id,),
        )
        # A user at this company may have validated/revalidated a document
        # belonging to a DIFFERENT company (validated_by has no company
        # scoping constraint at the DB level) - nullable FK, so null it
        # rather than delete the validation record itself, which belongs to
        # the other company's audit trail, not this one.
        cur.execute(
            "UPDATE document_validations SET validated_by = NULL "
            "WHERE validated_by IN (SELECT id FROM users WHERE company_id = %s)",
            (company_id,),
        )
        cur.execute("DELETE FROM users WHERE company_id = %s", (company_id,))
        cur.execute(
            "UPDATE companies SET name = %s, logo_path = NULL, legal_name = NULL, afm = NULL, billing_address = NULL "
            "WHERE id = %s",
            (f"[deleted company {company_id}]", company_id),
        )


def run() -> None:
    conninfo = DATABASE_URL
    processed: list[tuple[int, str, bool]] = []  # (company_id, name, was_full_deletion)

    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT c.id, c.name, c.deletion_requested_at, cs.cancelled_at "
                "FROM companies c LEFT JOIN company_subscriptions cs ON cs.company_id = c.id "
                "WHERE c.deletion_requested_at IS NOT NULL OR cs.cancelled_at IS NOT NULL"
            )
            candidates = cur.fetchall()

        now = datetime.utcnow()
        for company_id, name, deletion_requested_at, cancelled_at in candidates:
            deadline = _compute_deadline(deletion_requested_at, cancelled_at)
            if deadline is None or deadline > now:
                continue

            full_deletion = deletion_requested_at is not None
            files_removed = _delete_company_files(conn, company_id)
            _delete_company_content(conn, company_id)
            if full_deletion:
                _delete_company_account(conn, company_id)
            conn.commit()

            processed.append((company_id, name, full_deletion))
            print(
                f"Purged company {company_id} ('{name}'): "
                f"{'full deletion (account+content)' if full_deletion else 'content only (post-cancellation)'}, "
                f"{files_removed} file(s) removed, deadline was {deadline.date().isoformat()}"
            )

        if processed:
            title = f"Retention job purged {len(processed)} compan{'y' if len(processed) == 1 else 'ies'}"
            body = "\n".join(
                f"- #{cid} {name} ({'full deletion' if full else 'content only'})" for cid, name, full in processed
            )
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE role = 'super_admin' AND is_active = true")
                user_ids = [row[0] for row in cur.fetchall()]
                if user_ids:
                    cur.executemany(
                        "INSERT INTO notifications (user_id, type, title, body, link) VALUES (%s, %s, %s, %s, %s)",
                        [(uid, "retention_cleanup", title, body, "/admin/companies") for uid in user_ids],
                    )
            conn.commit()

    print(f"Retention cleanup complete: {len(processed)} company(ies) purged")


if __name__ == "__main__":
    run()

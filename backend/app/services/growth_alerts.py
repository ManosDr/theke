"""One-time super-admin alerts for the "revisit when N companies" triggers
recorded in KNOWN_DECISIONS.md - a real signal instead of relying on someone
remembering to go check the document and manually re-count real companies.

Every numeric threshold currently referenced by a KNOWN_DECISIONS.md
"revisit when more than N active companies" trigger must appear in
COMPANY_COUNT_THRESHOLDS below - update this list if a future entry adds a
new number, don't invent one that isn't backed by an actual entry."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Company, CompanyCountThresholdAlert
from app.services.notifications import notify_super_admins

# 3: "Dashboard analytics graphs" entry - revisit when more than 3 active companies.
COMPANY_COUNT_THRESHOLDS = [3]


def real_active_company_count(db: Session) -> int:
    """Active companies excluding test accounts - the same filter already
    used platform-wide in GET /admin/stats (Company.is_suspended.is_(False),
    Company.is_test_account.is_(False))."""
    return (
        db.scalar(
            select(func.count())
            .select_from(Company)
            .where(Company.is_suspended.is_(False), Company.is_test_account.is_(False))
        )
        or 0
    )


def check_company_count_thresholds(db: Session) -> None:
    """Fires a super-admin notification the first time the real active
    company count exceeds each threshold in COMPANY_COUNT_THRESHOLDS - never
    again after that (a row in company_count_threshold_alerts is the "already
    notified" flag). Cheap enough (one COUNT plus one tiny-table lookup per
    threshold) to call on every GET /admin/stats rather than needing its own
    scheduled job."""
    count = real_active_company_count(db)
    for threshold in COMPANY_COUNT_THRESHOLDS:
        if count <= threshold:
            continue
        if db.get(CompanyCountThresholdAlert, threshold):
            continue
        db.add(CompanyCountThresholdAlert(threshold=threshold))
        notify_super_admins(
            db,
            type="company_count_threshold",
            title=f"Πραγματικές ενεργές εταιρείες > {threshold}",
            body=(
                f"Ο αριθμός πραγματικών ενεργών εταιρειών (εξαιρουμένων δοκιμαστικών λογαριασμών) "
                f"ξεπέρασε το {threshold} - βρίσκεται τώρα στο {count}. Ορισμένες αποφάσεις στο "
                f"KNOWN_DECISIONS.md είχαν αναβληθεί μέχρι αυτό το σημείο (π.χ. γραφήματα ανάλυσης "
                f"στον πίνακα ελέγχου) - αξίζει να τις επανεξετάσετε."
            ),
        )
        db.commit()

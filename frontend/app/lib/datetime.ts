// Every datetime the backend returns is a naive UTC timestamp (no timezone
// designator - every DateTime column in backend/app/models.py is created
// via datetime.utcnow() with no tzinfo, and FastAPI/Pydantic serializes it
// as e.g. "2026-08-19T11:57:15.115322", not "...115322Z"). Per the
// ECMAScript Date-parsing spec, a date-time string with no offset is
// interpreted as LOCAL time, not UTC - so `new Date(apiValue)` silently
// treats the UTC wall-clock value as if it were already the viewer's local
// time, and every .toLocaleString()/.toLocaleDateString() call downstream
// just echoes the raw UTC digits back instead of converting (confirmed
// live: a login at 11:57:15 UTC displayed as "11:57:15 AM" instead of the
// correct 14:57:15 EEST).
//
// This appends "Z" - only when the string has a time component ("T") and
// doesn't already carry a timezone designator - so Date correctly treats
// it as UTC and every existing toLocale*() call converts to the viewer's
// actual local timezone automatically (Intl.DateTimeFormat under the
// hood), no hardcoded Athens offset. A bare date-only string (no "T", e.g.
// a DATE column like documents.last_verified_at, "2026-08-19") is left
// untouched - per the same spec it's already correctly treated as UTC
// midnight, and appending "Z" directly to a date-only string would produce
// an invalid ISO string.
const HAS_TZ_DESIGNATOR = /[Zz]|[+-]\d\d:?\d\d$/;

export function parseApiDate(iso: string): Date {
  if (!iso.includes("T") || HAS_TZ_DESIGNATOR.test(iso)) return new Date(iso);
  return new Date(`${iso}Z`);
}

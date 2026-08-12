"""Semi-automated ΥΔΟΜ/Πολεοδομία contact discovery for uncovered
(status='pending') municipalities, triggered from the admin UI's batch
runner (POST /admin/region-contact-discovery/run).

The domain-guess list, contact-path list, and phone/email extraction are
shared with crawler/crawler/region_contact_discovery.py via
theke_shared.contact_discovery (see that module's docstring). Only the
fetching (here: async httpx) and persistence (here: SQLAlchemy Session,
prioritized by region_requests count) differ, tied to this service's own
architecture - genuinely different from the crawler's sync requests + raw
psycopg from CLI args, not duplicated logic. See KNOWN_DECISIONS.md's
"crawler/backend discovery-logic duplication" entry.

Same safety property as the crawler version: this NEVER writes to
Region.contact_phone/Region.contact_email/Region.ydom_authority_name
directly. Every plausible match is inserted into region_contact_candidates
as an unverified row that only becomes live through a super admin's
explicit Confirm action. See KNOWN_DECISIONS.md.
"""

import asyncio
from datetime import datetime

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from theke_shared.contact_discovery import (
    CONTACT_PATHS,
    DOMAIN_TEMPLATES,
    extract_contact,
)

from app.models import Region, RegionContactCandidate, RegionRequest

USER_AGENT = "thekebot/0.1 (regulatory compliance assistant; contact: manos.drams@gmail.com)"
_REQUEST_TIMEOUT = 8.0
# Polite gap between sequential requests to the SAME host within one
# region's own domain-guess/contact-path loop (different regions are
# normally different hosts, so no cross-region delay is needed).
_SAME_HOST_DELAY_SECONDS = 1.5


async def _get(client: httpx.AsyncClient, url: str) -> httpx.Response | None:
    try:
        resp = await client.get(url, headers={"User-Agent": USER_AGENT}, timeout=_REQUEST_TIMEOUT)
    except httpx.HTTPError:
        return None
    return resp


async def _discover_one(client: httpx.AsyncClient, slug: str, name_en: str) -> dict | None:
    """Same two-stage approach as the crawler version: guess a domain from
    DOMAIN_TEMPLATES, stopping at the first one that resolves with a real
    200 response, then try each CONTACT_PATHS entry on that domain, falling
    back to the homepage itself if none of the specific paths respond."""
    s = slug.replace("-", "")
    base_url = None
    homepage_html = None
    for template in DOMAIN_TEMPLATES:
        candidate = template.format(s=s)
        resp = await _get(client, candidate)
        if resp is not None and resp.status_code == 200 and len(resp.text) > 500:
            base_url = candidate
            homepage_html = resp.text
            break
    if base_url is None:
        return None

    for path in CONTACT_PATHS:
        await asyncio.sleep(_SAME_HOST_DELAY_SECONDS)
        resp = await _get(client, base_url.rstrip("/") + path)
        if resp is None or resp.status_code != 200:
            continue
        phone, email = extract_contact(resp.text)
        if phone or email:
            return {
                "authority_name": f"Πολεοδομία/ΥΔΟΜ Δήμου {name_en}",
                "phone": phone,
                "email": email,
                "source_url": str(resp.url),
            }

    phone, email = extract_contact(homepage_html)
    if phone or email:
        return {
            "authority_name": f"Δήμος {name_en} (γενική επικοινωνία - όχι επιβεβαιωμένα στοιχεία ΥΔΟΜ)",
            "phone": phone,
            "email": email,
            "source_url": base_url,
        }
    return None


def next_batch_region_ids(db: Session, limit: int) -> list[str]:
    """Pending regions prioritized by accumulated region_requests count
    (descending), then alphabetically by Greek name as the tiebreaker - real
    user demand drives what gets attempted first. Regions with zero requests
    sort after every requested region, still alphabetically among themselves."""
    counts = (
        select(RegionRequest.region_id, func.count(RegionRequest.id).label("request_count"))
        .group_by(RegionRequest.region_id)
        .subquery()
    )
    query = (
        select(Region.region_id)
        .outerjoin(counts, counts.c.region_id == Region.region_id)
        .where(Region.status == "pending")
        .order_by(func.coalesce(counts.c.request_count, 0).desc(), Region.region_name_el.asc())
        .limit(limit)
    )
    return list(db.scalars(query).all())


async def run_batch(db: Session, region_ids: list[str]) -> dict:
    """Runs discovery for exactly the given region_ids (already selected by
    the caller, e.g. via next_batch_region_ids), writes any plausible match
    into region_contact_candidates, and returns a summary dict: found,
    not_found (list of region_ids), skipped (list of {region_id, reason})."""
    rows = {
        r.region_id: r
        for r in db.scalars(select(Region).where(Region.region_id.in_(region_ids))).all()
    }

    found = 0
    not_found: list[str] = []
    skipped: list[dict] = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for region_id in region_ids:
            region = rows.get(region_id)
            if region is None:
                skipped.append({"region_id": region_id, "reason": "not_found"})
                continue
            if region.status != "pending":
                skipped.append({"region_id": region_id, "reason": f"status={region.status}"})
                continue

            name_en_clean = region.region_name_en.replace("Municipality of ", "")
            candidate = await _discover_one(client, region_id, name_en_clean)
            if candidate is None:
                not_found.append(region_id)
                continue

            db.add(
                RegionContactCandidate(
                    region_id=region_id,
                    candidate_authority_name=candidate["authority_name"],
                    candidate_phone=candidate["phone"],
                    candidate_email=candidate["email"],
                    source_url=candidate["source_url"],
                    discovered_at=datetime.utcnow(),
                )
            )
            found += 1

    db.commit()
    return {
        "regions_attempted": len(region_ids),
        "candidates_found": found,
        "not_found": not_found,
        "skipped": skipped,
    }

"""Location services for project plots: reverse geocoding, cadastral/zone
lookups, and archaeological-zone flagging.

Two of these (cadastral parcel + GIS zone) are honest stubs, not "not yet
implemented" placeholders - GIS Phase 0's live API investigation confirmed
the public Ktimatologio cadastral WFS is dead (404, despite being the exact
URL registered in the government's own INSPIRE metadata) and TEE's SDIG has
no public WMS/WFS endpoint at all (see KNOWN_DECISIONS.md). Both functions
return `available: False` rather than attempting a call that's confirmed to
fail, or silently returning nothing.
"""

import logging

import httpx

from app.dependencies import CurrentUser
from app.models import Vertical
from app.services.rag import search_documents
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_USER_AGENT = "Theke/1.0 (contact@theke.gr)"
KTIMATOLOGIO_WMS_URL = "http://gis.ktimanet.gr/wms/wmsopen/wmsserver.aspx"

# A synthetic system-level caller for check_archaeological_flag()'s internal
# RAG query - company_id=None restricts it to public/national-scope KB
# content only, which is exactly the archaeological-zone documents this
# queries for; there's no real end user behind this specific lookup.
_SYSTEM_USER = CurrentUser(user_id=0, company_id=None, role="super_admin", company_type=None)

_ARCHAEOLOGICAL_DISTANCE_THRESHOLD = 0.45


async def reverse_geocode(lat: float, lon: float) -> dict | None:
    """Resolves coordinates to a Greek address via Nominatim. Returns None on
    any failure (network, non-200, no result) rather than raising - this is
    one of several parallel lookups in resolve_project_location() and a
    failure here shouldn't take down the others."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                NOMINATIM_URL,
                params={"format": "json", "lat": lat, "lon": lon, "addressdetails": 1},
                headers={"User-Agent": NOMINATIM_USER_AGENT},
            )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            return None
        address = data.get("address", {})
        municipality = (
            address.get("municipality")
            or address.get("city")
            or address.get("town")
            or address.get("village")
        )
        return {
            "display_name": data.get("display_name"),
            "municipality": municipality,
            "address": address,
        }
    except Exception:
        logger.exception("reverse_geocode failed for (%s, %s)", lat, lon)
        return None


async def lookup_cadastral_parcel(lat: float, lon: float) -> dict:
    """Stub: the public Ktimatologio cadastral-parcel WFS
    (gis.ktimanet.gr/inspire/.../InspireFeatureDownload/service) returns 404
    - confirmed dead in GIS Phase 0, despite being the exact URL the
    government's own INSPIRE geoportal lists as authoritative. Returns an
    honest unavailable status rather than attempting a call known to fail."""
    return {"available": False, "reason": "Η υπηρεσία WFS γεωτεμαχίων του Κτηματολογίου δεν είναι διαθέσιμη."}


async def lookup_gis_zone(lat: float, lon: float, municipality: str | None) -> dict:
    """Stub: TEE's SDIG (Ενιαίος Ψηφιακός Χάρτης) has no public WMS/WFS
    endpoint - confirmed in GIS Phase 0 (only a phone/email support contact
    is documented). Returns an honest unavailable status."""
    return {"available": False, "reason": "Το SDIG του ΤΕΕ δεν διαθέτει δημόσιο WFS/WMS endpoint."}


def check_archaeological_flag(db: Session, municipality: str | None) -> dict:
    """Flags a plot as potentially in an archaeological zone by querying the
    existing RAG infrastructure (ingested KB content) rather than a live API
    - the Archaeological Cadastre's own developer page is a JS-only SPA with
    no discoverable public endpoint (GIS Phase 0). Flags true only when a
    hit clears the same confidence bar chat retrieval uses AND the document
    actually mentions this municipality - a generic "what is an
    archaeological zone" document should never trigger a false positive."""
    if not municipality:
        return {"flag": False, "notes": None}

    construction_vertical = db.query(Vertical).filter(Vertical.slug == "construction").first()
    if construction_vertical is None:
        return {"flag": False, "notes": None}

    # Greek municipality names decline (Nominatim's "Δήμος Καβάλας" vs. a
    # document written as "...της Καβάλας" or just "Καβάλα") - stripping the
    # generic "Δήμος"/"Δήμου" prefix and truncating the core word's last 2
    # characters turns an exact-phrase match into a stem match, tolerant of
    # case endings without a full morphological analyzer. The bare "Δήμος"
    # prefix is dropped from the search query too, not just the post-filter
    # check - including it diluted both the embedding and the keyword match
    # enough that the actual Panagia/Kavala document fell out of the top-k
    # pool entirely in testing, never reaching the distance check below.
    core = municipality
    for prefix in ("Δήμος ", "Δήμου ", "Δήμο "):
        if core.startswith(prefix):
            core = core[len(prefix):]
            break
    stem = core[:-2] if len(core) > 4 else core

    # "αρχαιολογικοί περιορισμοί δόμησης {core}" scored measurably closer to
    # the Panagia/Kavala document than a bare "αρχαιολογική ζώνη {core}" in
    # testing (0.435 vs 0.549) - the construction-permit framing matches how
    # that document (and this whole vertical) actually phrases the topic.
    query = f"αρχαιολογικοί περιορισμοί δόμησης {core}"
    outcome = search_documents(db, _SYSTEM_USER, query, construction_vertical.id)

    # search_documents/visible_documents_filter don't filter by municipality
    # substring match on their own (that param only narrows *uploaded*
    # municipality documents, not manual_entry/public KB content) - so the
    # municipality check happens here, on the hit's own text, to avoid a
    # generic "what is an archaeological zone" document flagging every plot.
    for hit in outcome.hits:
        haystack = (hit.title or "") + hit.chunk_text
        if hit.distance < _ARCHAEOLOGICAL_DISTANCE_THRESHOLD and stem in haystack:
            return {
                "flag": True,
                "notes": f"Πιθανή αρχαιολογική ζώνη - βλ. \"{hit.title}\". Επιβεβαιώστε με την αρμόδια Εφορεία Αρχαιοτήτων.",
            }

    return {"flag": False, "notes": None}

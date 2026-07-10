"""Location services for project plots: reverse geocoding, cadastral parcel
lookup, GIS zone lookup, and archaeological-zone flagging.

lookup_gis_zone() remains an honest stub - TEE's SDIG (Ενιαίος Ψηφιακός
Χάρτης) has no public WMS/WFS endpoint at all (GIS Phase 0; only a
phone/email support contact is documented). lookup_cadastral_parcel() is NOT
a stub: the public Ktimatologio cadastral WFS at gis.ktimanet.gr is
confirmed dead (404), but the ArcGIS FeatureServer that powers the official
maps.ktimatologio.gr viewer itself is live and public - discovered by
observing that viewer's own network requests (see KNOWN_DECISIONS.md).
"""

import json
import logging
import math

import httpx

from app.models import ArchaeologicalSite
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "Theke/1.0 (contact@theke.gr)"
KTIMATOLOGIO_WMS_URL = "http://gis.ktimanet.gr/wms/wmsopen/wmsserver.aspx"

# The FeatureServer behind maps.ktimatologio.gr's own KAEK search (confirmed
# by watching its network requests during a live search for a real KAEK -
# see KNOWN_DECISIONS.md). Public, unauthenticated, CORS-open. Not an
# official/documented API - no published ToS or SLA, hence the timeout +
# graceful-fallback treatment below rather than treating it as guaranteed.
CADASTRAL_FEATURESERVER = (
    "https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services"
    "/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query"
)


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


async def forward_geocode(query: str) -> list[dict]:
    """Resolves a free-text address to candidate coordinates via Nominatim's
    /search endpoint, for the address-search field in the project location
    section. Proxied server-side (not called directly from the browser)
    specifically so the required custom User-Agent (Nominatim's usage
    policy) can actually be set - browsers refuse to let client-side JS
    override the User-Agent header at all, so a direct frontend call could
    never comply with the same policy reverse_geocode() above already
    honours. Returns an empty list on any failure rather than raising, same
    graceful-degradation shape as the rest of this module."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                NOMINATIM_SEARCH_URL,
                params={"q": query, "format": "json", "addressdetails": 1, "countrycodes": "gr", "limit": 5},
                headers={"User-Agent": NOMINATIM_USER_AGENT},
            )
        resp.raise_for_status()
        results = resp.json()
    except Exception:
        logger.exception("forward_geocode failed for query %r", query)
        return []

    return [
        {
            "display_name": r.get("display_name"),
            "type": r.get("type"),
            "lat": float(r["lat"]),
            "lon": float(r["lon"]),
        }
        for r in results
        if "lat" in r and "lon" in r
    ]


def _webmercator_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Convert EPSG:3857 (Web Mercator, what the FeatureServer returns) to
    WGS84 (lon, lat)."""
    lon = x / 20037508.342 * 180
    lat = math.degrees(2 * math.atan(math.exp(y / 20037508.342 * math.pi)) - math.pi / 2)
    return lon, lat


def _parse_parcel_feature(feat: dict) -> dict:
    """Shared shape for a single FeatureServer feature, used by both the
    by-KAEK and by-point lookups below."""
    attrs = feat.get("attributes", {})
    rings = feat.get("geometry", {}).get("rings", [[]])[0]

    wgs84_ring = [_webmercator_to_wgs84(x, y) for x, y in rings]

    lons = [p[0] for p in wgs84_ring]
    lats = [p[1] for p in wgs84_ring]
    centroid_lon = sum(lons) / len(lons)
    centroid_lat = sum(lats) / len(lats)

    return {
        "kaek": attrs.get("KAEK"),
        "available": True,
        "found": True,
        "area_sqm": round(attrs.get("AREA", 0), 2),
        "perimeter_m": round(attrs.get("PERIMETER", 0), 2),
        "centroid_lat": round(centroid_lat, 7),
        "centroid_lon": round(centroid_lon, 7),
        "geometry": {"type": "Polygon", "coordinates": [wgs84_ring]},
        "ktimatologio_link": attrs.get("LINK"),
    }


async def lookup_cadastral_parcel(kaek: str) -> dict:
    """Queries the Ktimatologio ArcGIS FeatureServer for a parcel by KAEK -
    the same public, unauthenticated endpoint the official maps.ktimatologio.gr
    viewer itself calls for its own KAEK search (see KNOWN_DECISIONS.md for
    how this was discovered and the dependency-risk tradeoff). Not an
    official/documented API, hence the timeout + broad exception handling:
    a service interruption degrades to `available: False` rather than
    crashing the feature, the same fallback pattern already used for
    Nominatim.

    Normalises the KAEK by stripping any trailing /N/N suffix (the format a
    user might copy from an official document, e.g. '210183315011/0/0')
    before querying - the FeatureServer's own KAEK field is the bare
    12-digit code only.
    """
    normalised = kaek.split("/")[0].strip()

    params = {
        "f": "json",
        "where": f"KAEK='{normalised}'",
        "outFields": "*",
        "returnGeometry": "true",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(CADASTRAL_FEATURESERVER, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.exception("lookup_cadastral_parcel failed for KAEK %s", normalised)
        return {"kaek": normalised, "available": False, "error": str(e)}

    features = data.get("features", [])
    if not features:
        return {"kaek": normalised, "available": True, "found": False}

    result = _parse_parcel_feature(features[0])
    result["kaek"] = normalised  # the queried KAEK, not attrs.get("KAEK") - same value, but avoids relying on the field being echoed back
    return result


async def lookup_parcel_by_point(lat: float, lon: float) -> dict:
    """Finds whichever parcel (if any) contains a given point, via a
    point-in-polygon spatial query against the same FeatureServer
    lookup_cadastral_parcel() uses - for the "found a KAEK from the
    bounding box" step after an address search or a manual pin drop, where
    the user hasn't typed a KAEK themselves. Live-verified against a known
    parcel (KAEK 210183315011's own centroid) before shipping: the spatial
    query returns the exact same parcel lookup_cadastral_parcel() does by
    name, confirming the FeatureServer accepts and correctly reprojects a
    WGS84 point despite storing geometry in Web Mercator natively."""
    params = {
        "f": "json",
        "geometry": json.dumps({"x": lon, "y": lat, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPoint",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "true",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(CADASTRAL_FEATURESERVER, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.exception("lookup_parcel_by_point failed for (%s, %s)", lat, lon)
        return {"kaek": None, "available": False, "error": str(e)}

    features = data.get("features", [])
    if not features:
        return {"kaek": None, "available": True, "found": False}

    return _parse_parcel_feature(features[0])


async def lookup_gis_zone(lat: float, lon: float, municipality: str | None) -> dict:
    """Stub: TEE's SDIG (Ενιαίος Ψηφιακός Χάρτης) has no public WMS/WFS
    endpoint - confirmed in GIS Phase 0 (only a phone/email support contact
    is documented). Returns an honest unavailable status."""
    return {"available": False, "reason": "Το SDIG του ΤΕΕ δεν διαθέτει δημόσιο WFS/WMS endpoint."}


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Returns the great-circle distance in metres between two WGS84 points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def check_archaeological_flag(lat: float, lon: float, db: Session) -> dict:
    """Flags a plot by coordinate proximity to a known protected
    archaeological site (Haversine distance against archaeological_sites),
    not by municipality-name text matching. The earlier RAG/municipality
    approach flagged every plot anywhere in a site's entire municipality
    regardless of actual distance from the declared zone - a false-positive
    problem, not a coverage gap (see KNOWN_DECISIONS.md). This is honest
    about its own limitation in the other direction: radii are conservative
    manually-curated estimates, not official surveyed zone boundaries, so a
    plot just outside a radius is not guaranteed clear."""
    sites = db.query(ArchaeologicalSite).all()
    matches = []
    for site in sites:
        distance_m = haversine_distance(lat, lon, float(site.lat), float(site.lon))
        if distance_m <= site.protection_radius_m:
            matches.append({"site": site, "distance_m": round(distance_m)})

    if not matches:
        return {"flag": False, "notes": None, "site_name": None, "distance_m": None}

    closest = min(matches, key=lambda m: m["distance_m"])
    site = closest["site"]
    notes = (
        f"Το τεμάχιο βρίσκεται εντός {closest['distance_m']}μ. από τον "
        f"αρχαιολογικό χώρο {site.name_el}. "
        f"{site.protection_zone_description or ''} "
        f"Νομική βάση: {site.legal_basis}. "
        f"Απαιτείται γνωμοδότηση από την αρμόδια Εφορεία Αρχαιοτήτων "
        f"πριν από οποιαδήποτε εκσκαφή ή κατασκευαστική εργασία."
    ).replace("  ", " ").strip()
    return {
        "flag": True,
        "notes": notes,
        "site_name": site.name_el,
        "distance_m": closest["distance_m"],
    }

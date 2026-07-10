import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.schemas import (
    GeocodeResult,
    ParcelLookupResponse,
    ResolveLocationRequest,
    ResolveLocationResponse,
    ServicesAvailable,
)
from app.services.gis import (
    check_archaeological_flag,
    forward_geocode,
    lookup_cadastral_parcel,
    lookup_gis_zone,
    lookup_parcel_by_point,
    reverse_geocode,
)

router = APIRouter(prefix="/gis", tags=["gis"])

_RESOLVE_TIMEOUT_SECONDS = 15.0


@router.get("/parcel/{kaek:path}", response_model=ParcelLookupResponse)
async def get_parcel(
    kaek: str,
    user: CurrentUser = Depends(get_current_user),
) -> ParcelLookupResponse:
    """Standalone KAEK lookup - what the KAEK search field in the map picker
    calls. See lookup_cadastral_parcel() for the FeatureServer this queries.
    Uses the `:path` converter, not a plain string, because a KAEK is
    commonly written with a trailing "/0/0" suffix (e.g. "210183315011/0/0")
    - a plain path segment can't match a literal slash, which 404'd every
    such lookup until this was caught by test_kaek_lookup_found."""
    try:
        async with asyncio.timeout(_RESOLVE_TIMEOUT_SECONDS):
            result = await lookup_cadastral_parcel(kaek)
    except TimeoutError:
        result = {"kaek": kaek.split("/")[0].strip(), "available": False, "error": "timeout"}
    return ParcelLookupResponse(**result)


@router.get("/geocode", response_model=list[GeocodeResult])
async def geocode_address(
    q: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[GeocodeResult]:
    """Address-search field in the project location section - proxies
    Nominatim forward geocoding server-side (see forward_geocode()'s
    docstring for why this can't be called directly from the browser)."""
    if not q.strip():
        return []
    try:
        async with asyncio.timeout(_RESOLVE_TIMEOUT_SECONDS):
            results = await forward_geocode(q.strip())
    except TimeoutError:
        results = []
    return [GeocodeResult(**r) for r in results]


@router.post("/resolve-location", response_model=ResolveLocationResponse)
async def resolve_location(
    payload: ResolveLocationRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ResolveLocationResponse:
    """Resolves a dropped map pin (or, when `kaek` is provided, a searched
    cadastral parcel): reverse-geocodes the address, attempts a GIS-zone
    lookup (confirmed unavailable as a live service - see
    KNOWN_DECISIONS.md - so it returns an honest unavailable status rather
    than fake data), and checks known archaeological sites by coordinate
    proximity. When `kaek` is given, its resolved centroid supersedes the
    request's lat/lon for every downstream lookup - the KAEK is the more
    precise input, matching the frontend's "search KAEK -> populate
    location panel exactly like a pin drop" flow.
    """
    lat, lon = payload.lat, payload.lon
    cadastral: dict = {"available": False}

    if payload.kaek:
        try:
            async with asyncio.timeout(_RESOLVE_TIMEOUT_SECONDS):
                cadastral = await lookup_cadastral_parcel(payload.kaek)
        except TimeoutError:
            cadastral = {"kaek": payload.kaek.split("/")[0].strip(), "available": False, "error": "timeout"}
        if cadastral.get("found") and cadastral.get("centroid_lat") is not None:
            lat, lon = cadastral["centroid_lat"], cadastral["centroid_lon"]
    else:
        # No KAEK typed - this is an address-search or manual-pin-drop
        # resolve, so attempt the reverse direction instead: does a parcel
        # exist that contains this exact point? Live-verified against the
        # ArcGIS FeatureServer (see lookup_parcel_by_point()'s docstring).
        # A miss here is expected and not an error - not every point falls
        # inside a mapped parcel.
        try:
            async with asyncio.timeout(_RESOLVE_TIMEOUT_SECONDS):
                cadastral = await lookup_parcel_by_point(lat, lon)
        except TimeoutError:
            cadastral = {"kaek": None, "available": False, "error": "timeout"}

    try:
        async with asyncio.timeout(_RESOLVE_TIMEOUT_SECONDS):
            geocode_result, zone_result = await asyncio.gather(
                reverse_geocode(lat, lon),
                lookup_gis_zone(lat, lon, None),
                return_exceptions=True,
            )
    except TimeoutError:
        geocode_result, zone_result = None, {"available": False}

    geocode = geocode_result if isinstance(geocode_result, dict) else None
    zone = zone_result if isinstance(zone_result, dict) else {"available": False}

    municipality = geocode.get("municipality") if geocode else None
    archaeological = check_archaeological_flag(lat, lon, db)

    return ResolveLocationResponse(
        lat=lat,
        lon=lon,
        address=geocode.get("display_name") if geocode else None,
        municipality=municipality,
        kaek=cadastral.get("kaek") if cadastral.get("found") else None,
        plot_area_sqm=cadastral.get("area_sqm"),
        parcel_geometry=cadastral.get("geometry"),
        gis_zone_name=zone.get("gis_zone_name"),
        archaeological_flag=archaeological["flag"],
        archaeological_notes=archaeological["notes"],
        archaeological_site_name=archaeological.get("site_name"),
        archaeological_distance_m=archaeological.get("distance_m"),
        ktimatologio_link=cadastral.get("ktimatologio_link"),
        services_available=ServicesAvailable(
            geocoding=geocode is not None,
            cadastral=cadastral.get("available", False),
            gis_zone=zone.get("available", False),
        ),
    )

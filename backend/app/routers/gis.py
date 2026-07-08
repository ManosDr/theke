import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.schemas import ResolveLocationRequest, ResolveLocationResponse, ServicesAvailable
from app.services.gis import check_archaeological_flag, lookup_cadastral_parcel, lookup_gis_zone, reverse_geocode

router = APIRouter(prefix="/gis", tags=["gis"])

_RESOLVE_TIMEOUT_SECONDS = 15.0


@router.post("/resolve-location", response_model=ResolveLocationResponse)
async def resolve_location(
    payload: ResolveLocationRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ResolveLocationResponse:
    """Resolves a dropped map pin: reverse-geocodes the address, attempts a
    cadastral parcel and GIS-zone lookup (both confirmed unavailable as live
    services - see KNOWN_DECISIONS.md - so these return an honest
    unavailable status rather than fake data), and checks the KB for an
    archaeological-zone flag once the municipality is known. Runs the two
    independent network calls in parallel; a failure in one (timeout,
    unexpected exception) never blocks the others thanks to
    return_exceptions=True.
    """
    try:
        async with asyncio.timeout(_RESOLVE_TIMEOUT_SECONDS):
            geocode_result, cadastral_result, zone_result = await asyncio.gather(
                reverse_geocode(payload.lat, payload.lon),
                lookup_cadastral_parcel(payload.lat, payload.lon),
                lookup_gis_zone(payload.lat, payload.lon, None),
                return_exceptions=True,
            )
    except TimeoutError:
        geocode_result, cadastral_result, zone_result = None, {"available": False}, {"available": False}

    geocode = geocode_result if isinstance(geocode_result, dict) else None
    cadastral = cadastral_result if isinstance(cadastral_result, dict) else {"available": False}
    zone = zone_result if isinstance(zone_result, dict) else {"available": False}

    municipality = geocode.get("municipality") if geocode else None
    archaeological = check_archaeological_flag(db, municipality)

    return ResolveLocationResponse(
        lat=payload.lat,
        lon=payload.lon,
        address=geocode.get("display_name") if geocode else None,
        municipality=municipality,
        kaek=cadastral.get("kaek"),
        plot_area_sqm=cadastral.get("plot_area_sqm"),
        parcel_geometry=cadastral.get("parcel_geometry"),
        gis_zone_name=zone.get("gis_zone_name"),
        archaeological_flag=archaeological["flag"],
        archaeological_notes=archaeological["notes"],
        services_available=ServicesAvailable(
            geocoding=geocode is not None,
            cadastral=cadastral.get("available", False),
            gis_zone=zone.get("available", False),
        ),
    )

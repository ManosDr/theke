"""Section 1.7 / Section 7 - GIS tests.

reverse_geocode() and lookup_cadastral_parcel() (app/services/gis.py) both
call real public external APIs over the network (Nominatim, and the ArcGIS
FeatureServer behind the official Ktimatologio viewer, respectively) - these
tests inherit that external dependency (same no-mocking philosophy as the
rest of this suite) and can fail on either service being unreachable,
rate-limiting, or changing its response shape, independent of any real
regression in theke's own code. Flag a failure here as
"environment-dependent, re-run before treating as a real bug" rather than
an automatic release blocker.

One correction to the test plan: test_reverse_geocode_invalid_coordinates
assumed the response has an "error" field for the invalid-coordinates case.
ResolveLocationResponse (app/schemas.py) has no such field - graceful
degradation is signaled the same way any other lookup failure is, via
null fields and services_available.geocoding=False.

check_archaeological_flag() was rewritten during Section 7 pre-release
testing from municipality-name RAG matching to Haversine-distance proximity
against a curated `archaeological_sites` table - see KNOWN_DECISIONS.md.
PANAGIA_KAVALA below uses the Nominatim-verified site centroid (the
original test-plan coordinates were ~550-600m off, in a different Kavala
quarter entirely, and would no longer flag true under the precise
proximity check). test_archaeological_flag_non_protected's xfail marker
is gone: the bug it documented (any point anywhere in Δήμος Καβάλας
flagging true) is fixed.
"""

import pytest

from app.models import Project

KAVALA_CITY_CENTRE = {"lat": 40.9375, "lon": 24.4023}
PANAGIA_KAVALA = {"lat": 40.9334868, "lon": 24.4149126}
PHILIPPI_SITE = {"lat": 41.0132841, "lon": 24.2839744}
ABDERA_SITE = {"lat": 40.9446, "lon": 24.9746}
THASSOS_SITE = {"lat": 40.7795291, "lon": 24.7134019}
AMPHIPOLIS_SITE = {"lat": 40.8162, "lon": 23.8523}
XANTHI_INDUSTRIAL_CONTROL = {"lat": 41.1300, "lon": 24.8800}
PAGGAIO_KAEK = "210183315011/0/0"


def test_reverse_geocode_kavala(client, member_headers):
    resp = client.post("/gis/resolve-location", json=KAVALA_CITY_CENTRE, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["address"] is not None
    assert body["municipality"] is not None
    # Nominatim returns "Δήμος Καβάλας" - the tonos on "ά" (U+03AC) means a
    # plain unaccented "καβαλ" never matches "καβάλας".lower(); check
    # against the actual accented stem instead.
    municipality = body["municipality"].lower()
    assert "καβάλ" in municipality or "kavala" in municipality


def test_reverse_geocode_invalid_coordinates(client, member_headers):
    resp = client.post("/gis/resolve-location", json={"lat": 999, "lon": 999}, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["address"] is None
    assert body["services_available"]["geocoding"] is False


def test_archaeological_flag_panagia(client, member_headers):
    resp = client.post("/gis/resolve-location", json=PANAGIA_KAVALA, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["archaeological_flag"] is True
    assert body["archaeological_notes"]


def test_archaeological_flag_non_protected(client, member_headers):
    resp = client.post("/gis/resolve-location", json=KAVALA_CITY_CENTRE, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["archaeological_flag"] is False
    assert body["archaeological_site_name"] is None


@pytest.mark.parametrize(
    ("point", "expected_site_substring"),
    [
        (PHILIPPI_SITE, "Φιλίππ"),
        (ABDERA_SITE, "Άβδηρα"),
        (THASSOS_SITE, "Θάσ"),
        (AMPHIPOLIS_SITE, "Αμφίπολη"),
    ],
)
def test_archaeological_flag_all_seeded_sites(client, member_headers, point, expected_site_substring):
    resp = client.post("/gis/resolve-location", json=point, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["archaeological_flag"] is True
    assert body["archaeological_site_name"] is not None
    assert expected_site_substring in body["archaeological_site_name"]
    assert body["archaeological_distance_m"] is not None


def test_archaeological_flag_xanthi_industrial_control(client, member_headers):
    resp = client.post("/gis/resolve-location", json=XANTHI_INDUSTRIAL_CONTROL, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["archaeological_flag"] is False
    assert body["archaeological_site_name"] is None


def test_cadastral_attempted_via_point_lookup_without_kaek(client, member_headers):
    """Superseded during Section 7 Phase 2 (unified location input): a
    resolve-location call with no explicit KAEK used to leave cadastral
    lookup entirely unattempted (`available: False` unconditionally). It now
    always attempts lookup_parcel_by_point() - the point-in-polygon spatial
    query behind the address-search/manual-pin-drop flows - so the service
    is genuinely queried even without a typed KAEK. Kavala's city centre
    happens to fall inside a real mapped parcel (confirmed live), so this
    also exercises the "found" path, not just "available but not found"."""
    resp = client.post("/gis/resolve-location", json=KAVALA_CITY_CENTRE, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["services_available"]["cadastral"] is True
    assert body["kaek"] is not None


def test_kaek_lookup_found(client, member_headers):
    resp = client.get(f"/gis/parcel/{PAGGAIO_KAEK}", headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is True
    assert body["found"] is True
    assert body["kaek"] == "210183315011"
    assert body["area_sqm"] == pytest.approx(412.92, abs=0.5)
    assert body["centroid_lat"] is not None
    assert body["centroid_lon"] is not None
    assert body["ktimatologio_link"]


def test_kaek_lookup_accepts_bare_kaek(client, member_headers):
    resp = client.get("/gis/parcel/210183315011", headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["found"] is True
    assert body["area_sqm"] == pytest.approx(412.92, abs=0.5)


def test_kaek_lookup_not_found(client, member_headers):
    resp = client.get("/gis/parcel/999999999999", headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is True
    assert body["found"] is False


def test_resolve_location_with_kaek_uses_cadastral_centroid(client, member_headers):
    resp = client.post(
        "/gis/resolve-location",
        json={"lat": 0, "lon": 0, "kaek": PAGGAIO_KAEK},
        headers=member_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["services_available"]["cadastral"] is True
    assert body["kaek"] == "210183315011"
    assert body["plot_area_sqm"] == pytest.approx(412.92, abs=0.5)
    # Centroid override: response location should be near Paggaio, not (0, 0).
    assert body["lat"] != 0
    assert body["municipality"] is not None
    assert "Παγγαίου" in body["municipality"]


def test_resolve_location_finds_kaek_by_point_without_explicit_kaek(client, member_headers):
    """The bounding-box/point-in-polygon path added for Section 7 Phase 2
    (address search, manual pin drop): the same Paggaio parcel found by
    KAEK above should also be found by its own centroid coordinates alone,
    with no kaek in the request at all."""
    resp = client.post(
        "/gis/resolve-location",
        json={"lat": 40.9210624, "lon": 24.2644079},
        headers=member_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["services_available"]["cadastral"] is True
    assert body["kaek"] == "210183315011"
    assert body["plot_area_sqm"] == pytest.approx(412.92, abs=0.5)


def test_geocode_address(client, member_headers):
    resp = client.get("/gis/geocode", params={"q": "Ομονοίας 10, Καβάλα"}, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) > 0
    assert all("lat" in r and "lon" in r for r in body)
    assert any("Καβάλα" in (r["display_name"] or "") for r in body)


def test_geocode_empty_query_returns_empty_list(client, member_headers):
    resp = client.get("/gis/geocode", params={"q": ""}, headers=member_headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_plot_in_plan_round_trip(client, member_headers, db_session):
    """Ζώνη οικισμού toggle (Section 7 Phase 2) - create a project, set it
    true then false via the standalone endpoint, confirm each persists."""
    create_resp = client.post(
        "/projects",
        json={"name": "Plot-in-plan test project", "municipality": "Δήμος Καβάλας", "region_id": "kavala"},
        headers=member_headers,
    )
    assert create_resp.status_code == 201
    project_id = create_resp.json()["id"]
    try:
        assert create_resp.json()["plot_in_plan"] is None

        true_resp = client.patch(f"/projects/{project_id}/plot-in-plan", json={"plot_in_plan": True}, headers=member_headers)
        assert true_resp.status_code == 200
        assert true_resp.json()["plot_in_plan"] is True

        false_resp = client.patch(f"/projects/{project_id}/plot-in-plan", json={"plot_in_plan": False}, headers=member_headers)
        assert false_resp.status_code == 200
        assert false_resp.json()["plot_in_plan"] is False
    finally:
        project = db_session.get(Project, project_id)
        if project:
            db_session.delete(project)
            db_session.commit()

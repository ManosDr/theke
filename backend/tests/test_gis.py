"""Section 1.7 - GIS tests.

reverse_geocode() (app/services/gis.py) calls the real public Nominatim API
over the network - these tests inherit that external dependency (same
no-mocking philosophy as the rest of this suite) and can fail on Nominatim
being unreachable/rate-limiting/changing its response shape, independent of
any real regression in theke's own code. Flag a failure here as
"environment-dependent, re-run before treating as a real bug" rather than
an automatic release blocker.

One correction to the test plan: test_reverse_geocode_invalid_coordinates
assumed the response has an "error" field for the invalid-coordinates case.
ResolveLocationResponse (app/schemas.py) has no such field - graceful
degradation is signaled the same way any other lookup failure is, via
null fields and services_available.geocoding=False.

One real finding, not a test bug: test_archaeological_flag_non_protected is
marked xfail - see its docstring below.
"""

import pytest

KAVALA_CITY_CENTRE = {"lat": 40.9375, "lon": 24.4023}
PANAGIA_KAVALA = {"lat": 40.9389, "lon": 24.4131}


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


@pytest.mark.xfail(
    reason=(
        "Real finding, confirmed by reading check_archaeological_flag() (app/services/gis.py): "
        "it flags by MUNICIPALITY NAME STRING match against the KB, with no lat/lon precision at "
        "all - Panagia has no separate municipality of its own, it resolves to the same 'Δήμος "
        "Καβάλας' as the rest of Kavala city (confirmed via test_reverse_geocode_kavala), so any "
        "coordinate anywhere in the Kavala municipality gets the same archaeological_flag=True "
        "that doc 318 (Παναγία Καβάλας) triggers. Not a coordinates bug in this test - reproduced "
        "directly against the real endpoint. See the final report's Bugs Found section."
    ),
    strict=True,
)
def test_archaeological_flag_non_protected(client, member_headers):
    resp = client.post("/gis/resolve-location", json=KAVALA_CITY_CENTRE, headers=member_headers)
    assert resp.status_code == 200
    assert resp.json()["archaeological_flag"] is False


def test_cadastral_stub_graceful(client, member_headers):
    resp = client.post("/gis/resolve-location", json=KAVALA_CITY_CENTRE, headers=member_headers)
    assert resp.status_code == 200
    assert resp.json()["services_available"]["cadastral"] is False

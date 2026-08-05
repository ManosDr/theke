"""Regression coverage for the customer-phone-length bug found during the
Section 0 security audit: customers.phone is varchar(20) (db/init.sql), and
an overlong value used to reach Postgres uncaught, raising a raw
StringDataRightTruncation (500) instead of the clean 422 the API should
return. Fixed by _validate_phone_length() in app/routers/customers.py."""


def test_create_customer_overlong_phone_returns_clean_422(client, member_headers):
    resp = client.post(
        "/customers",
        json={"name": "Overlong Phone Test", "phone": "1" * 21},
        headers=member_headers,
    )
    assert resp.status_code == 422
    assert "20" in resp.json()["detail"]


def test_create_customer_max_length_phone_succeeds(client, db_session, member_headers):
    resp = client.post(
        "/customers",
        json={"name": "Max Length Phone Test", "phone": "1" * 20},
        headers=member_headers,
    )
    try:
        assert resp.status_code == 201, resp.text
    finally:
        from sqlalchemy import text

        db_session.execute(text("DELETE FROM customers WHERE name = 'Max Length Phone Test'"))
        db_session.commit()

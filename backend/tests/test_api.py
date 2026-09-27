import os
import subprocess
import sys

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.main import app
from app.models import Rate, User


def test_collector_to_payment_workflow():
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={
            "email": "collector@demo.kabadwala.local", "password": "DemoCollector2026!",
        })
        assert login.status_code == 200
        collector_token = login.json()["access_token"]
        collector = {"Authorization": f"Bearer {collector_token}"}

        prices = client.get("/api/prices")
        assert prices.status_code == 200
        assert len(prices.json()["rates"]) == 6
        matches = client.get("/api/recyclers", params={
            "material": "laptop", "latitude": 18.52, "longitude": 73.85,
        }, headers=collector)
        assert matches.status_code == 200
        recycler_id = matches.json()["recyclers"][0]["id"]

        created = client.post("/api/lots", headers=collector, json={
            "material": "laptop", "weight_kg": 2.5, "condition": "good",
            "latitude": 18.52, "longitude": 73.85, "recycler_id": recycler_id,
            "collection_mode": "pickup", "description": "Laptop for responsible recycling",
            "client_ref": "test-collection-0001",
        })
        assert created.status_code == 201, created.text
        lot = created.json()
        assert lot["status"] == "requested"
        assert lot["lot_code"].startswith("EW-")

        recycler = None
        for email in (
            "recycler.green@demo.kabadwala.local",
            "recycler.eco@demo.kabadwala.local",
            "recycler.clean@demo.kabadwala.local",
        ):
            candidate = client.post("/api/auth/login", json={
                "email": email, "password": "DemoRecycler2026!",
            })
            candidate_headers = {"Authorization": f"Bearer {candidate.json()['access_token']}"}
            if client.get("/api/auth/me", headers=candidate_headers).json()["id"] == recycler_id:
                recycler = candidate_headers
                break
        assert recycler is not None
        accepted = client.post(f"/api/lots/{lot['id']}/accept", headers=recycler)
        assert accepted.status_code == 200, accepted.text
        handover = client.post(f"/api/lots/{lot['id']}/handover", headers=recycler, json={
            "lot_code": lot["lot_code"], "confirmed_material": "laptop",
            "idempotency_key": "test-handover-0001",
        })
        assert handover.status_code == 200, handover.text
        paid = client.post(f"/api/lots/{lot['id']}/payment", headers=recycler, json={
            "amount": 760, "method": "upi", "reference": "UTR-DEMO-1",
            "idempotency_key": "test-payment-0001",
        })
        assert paid.status_code == 200, paid.text
        assert paid.json()["lot"]["status"] == "paid"
        assert paid.json()["lot"]["final_price"] == 760
        assert client.get(f"/api/lots/{lot['id']}", headers=collector).json()["payment"]["status"] == "paid"

        outsider_login = client.post("/api/auth/login", json={
            "email": "recycler.eco@demo.kabadwala.local", "password": "DemoRecycler2026!",
        })
        outsider = {"Authorization": f"Bearer {outsider_login.json()['access_token']}"}
        replay = client.post(f"/api/lots/{lot['id']}/handover", headers=outsider, json={
            "lot_code": lot["lot_code"], "idempotency_key": "test-handover-0001",
        })
        assert replay.status_code == 403


def test_auth_roles_and_missing_classifier_are_explicit():
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={
            "email": "collector@demo.kabadwala.local", "password": "DemoCollector2026!",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert client.get("/api/admin/recyclers", headers=headers).status_code == 403
        response = client.post("/api/ai/classify", headers=headers, json={"image_data_url": "data:image/png;base64," + "a" * 120})
        assert response.status_code in {422, 503}


def test_registration_validation_and_revocable_sessions():
    with TestClient(app) as client:
        registered = client.post("/api/auth/register", json={
            "name": "QA Collector", "email": "qa.collector@example.test",
            "password": "A-strong-password-2026", "preferred_language": "mr",
            "account_type": "collector",
        })
        assert registered.status_code == 201, registered.text
        token = registered.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/auth/me", headers=headers).json()["preferred_language"] == "mr"
        assert client.post("/api/auth/logout", headers=headers).status_code == 204
        assert client.get("/api/auth/me", headers=headers).status_code == 401

        duplicate = client.post("/api/auth/register", json={
            "name": "Another Collector", "email": "QA.Collector@example.test",
            "password": "A-strong-password-2026",
        })
        assert duplicate.status_code == 409

        signed_in = client.post("/api/auth/login", json={
            "email": "qa.collector@example.test", "password": "A-strong-password-2026",
        })
        assert signed_in.status_code == 200
        signed_in_headers = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
        invalid_location = client.post("/api/prices/quote", headers=signed_in_headers, json={
            "material": "laptop", "weight_kg": 2, "condition": "good", "latitude": 18.52,
        })
        assert invalid_location.status_code == 422


def test_production_does_not_seed_demo_data(monkeypatch):
    from app import seed

    test_engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=test_engine)
    monkeypatch.setattr(seed, "APP_ENV", "production")
    monkeypatch.setattr(seed, "SEED_DEMO", False)
    with Session(test_engine) as db:
        seed.seed_demo_data(db)
        assert db.scalar(select(Rate.id)) is None
        assert db.scalar(select(User.id)) is None
    test_engine.dispose()


def test_production_rejects_example_secret():
    environment = os.environ.copy()
    environment["APP_ENV"] = "production"
    environment["APP_SECRET"] = "replace-with-a-long-random-secret"
    result = subprocess.run(
        [sys.executable, "-c", "import app.config"],
        cwd=os.path.dirname(os.path.dirname(__file__)),
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "at least 32 characters" in result.stderr

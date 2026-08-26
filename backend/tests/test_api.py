from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi.testclient import TestClient

from stockroom.main import create_app


def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(tmp_path / "test.db"))


def transfer_payload() -> dict[str, object]:
    return {
        "kind": "transfer",
        "productId": "prd-lamp",
        "fromLocationId": "loc-north",
        "toLocationId": "loc-retail",
        "quantity": 5,
        "reason": "Rebalance retail display stock",
        "actor": "Hassan Ak",
        "expectedSourceVersion": 1,
        "expectedDestinationVersion": 1,
    }


def test_dashboard_is_seeded_and_has_security_headers(tmp_path: Path) -> None:
    with client(tmp_path) as app:
        response = app.get("/api/dashboard")

    assert response.status_code == 200
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-request-id"]
    body = response.json()
    assert body["metrics"]["totalUnits"] == 185
    assert len(body["items"]) == 5
    assert body["items"][0]["balances"]


def test_javascript_assets_use_a_browser_safe_content_type() -> None:
    assert mimetypes.guess_type("app.js")[0] == "application/javascript"


def test_transfer_is_atomic_and_idempotent(tmp_path: Path) -> None:
    with client(tmp_path) as app:
        created = app.post(
            "/api/movements",
            json=transfer_payload(),
            headers={"Idempotency-Key": "transfer-test-001"},
        )
        replayed = app.post(
            "/api/movements",
            json=transfer_payload(),
            headers={"Idempotency-Key": "transfer-test-001"},
        )
        dashboard = app.get("/api/dashboard").json()

    assert created.status_code == 201
    assert created.json()["replayed"] is False
    assert replayed.status_code == 200
    assert replayed.json()["replayed"] is True
    lamp = next(item for item in dashboard["items"] if item["id"] == "prd-lamp")
    north = next(balance for balance in lamp["balances"] if balance["locationId"] == "loc-north")
    retail = next(balance for balance in lamp["balances"] if balance["locationId"] == "loc-retail")
    assert (north["quantity"], retail["quantity"]) == (37, 14)


def cycle_count_payload() -> dict[str, object]:
    return {
        "productId": "prd-lamp",
        "locationId": "loc-north",
        "countedQuantity": 39,
        "reason": "Monthly shelf count",
        "actor": "Hassan Ak",
        "expectedVersion": 1,
    }


def test_cycle_count_reconciles_balance_and_preserves_variance(tmp_path: Path) -> None:
    with client(tmp_path) as app:
        created = app.post(
            "/api/cycle-counts",
            json=cycle_count_payload(),
            headers={"Idempotency-Key": "cycle-count-test-001"},
        )
        replayed = app.post(
            "/api/cycle-counts",
            json=cycle_count_payload(),
            headers={"Idempotency-Key": "cycle-count-test-001"},
        )
        dashboard = app.get("/api/dashboard").json()

    assert created.status_code == 201
    assert created.json()["cycleCount"]["previousQuantity"] == 42
    assert created.json()["cycleCount"]["countedQuantity"] == 39
    assert created.json()["cycleCount"]["variance"] == -3
    assert replayed.status_code == 200
    assert replayed.json()["replayed"] is True
    lamp = next(item for item in dashboard["items"] if item["id"] == "prd-lamp")
    north = next(balance for balance in lamp["balances"] if balance["locationId"] == "loc-north")
    assert (north["quantity"], north["version"]) == (39, 2)
    assert dashboard["cycleCounts"][0]["reason"] == "Monthly shelf count"


def test_stale_cycle_count_does_not_change_inventory(tmp_path: Path) -> None:
    payload = cycle_count_payload() | {"expectedVersion": 99}
    with client(tmp_path) as app:
        response = app.post(
            "/api/cycle-counts",
            json=payload,
            headers={"Idempotency-Key": "cycle-count-test-002"},
        )
        dashboard = app.get("/api/dashboard").json()

    assert response.status_code == 409
    lamp = next(item for item in dashboard["items"] if item["id"] == "prd-lamp")
    north = next(balance for balance in lamp["balances"] if balance["locationId"] == "loc-north")
    assert (north["quantity"], north["version"]) == (42, 1)
    assert dashboard["cycleCounts"] == []


def test_insufficient_stock_rolls_back(tmp_path: Path) -> None:
    payload = transfer_payload() | {"quantity": 500}
    with client(tmp_path) as app:
        response = app.post(
            "/api/movements",
            json=payload,
            headers={"Idempotency-Key": "transfer-test-002"},
        )
        dashboard = app.get("/api/dashboard").json()

    assert response.status_code == 409
    lamp = next(item for item in dashboard["items"] if item["id"] == "prd-lamp")
    north = next(balance for balance in lamp["balances"] if balance["locationId"] == "loc-north")
    retail = next(balance for balance in lamp["balances"] if balance["locationId"] == "loc-retail")
    assert (north["quantity"], retail["quantity"]) == (42, 9)


def test_stale_version_is_rejected(tmp_path: Path) -> None:
    payload = transfer_payload() | {"expectedSourceVersion": 7}
    with client(tmp_path) as app:
        response = app.post(
            "/api/movements",
            json=payload,
            headers={"Idempotency-Key": "transfer-test-003"},
        )

    assert response.status_code == 409
    assert "refresh" in response.json()["detail"]


def test_movement_route_validation(tmp_path: Path) -> None:
    payload = transfer_payload() | {"toLocationId": "loc-north"}
    with client(tmp_path) as app:
        response = app.post(
            "/api/movements",
            json=payload,
            headers={"Idempotency-Key": "transfer-test-004"},
        )

    assert response.status_code == 422

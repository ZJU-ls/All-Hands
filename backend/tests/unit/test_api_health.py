"""Health endpoint smoke test. Ensures the FastAPI app factory wires up."""

from __future__ import annotations

from fastapi.testclient import TestClient

from allhands import __version__
from allhands.api import create_app


def test_health_returns_ok_and_version() -> None:
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body == {"status": "ok", "version": __version__}

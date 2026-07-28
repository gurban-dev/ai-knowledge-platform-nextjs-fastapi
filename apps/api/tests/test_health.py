"""API smoke tests — health + error envelope (no DB required for liveness/404)."""

from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient

# Minimal env so Settings() can construct during import/app create.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://akp:akp_dev_password@localhost:5432/akp?schema=public",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault(
    "JWT_ACCESS_SECRET",
    "test-access-secret-000000000000000000000",
)
os.environ.setdefault(
    "JWT_REFRESH_SECRET",
    "test-refresh-secret-11111111111111111111",
)
os.environ.setdefault("NODE_ENV", "test")

from akp_api.app import create_app  # noqa: E402
from akp_config import clear_settings_cache  # noqa: E402


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client() -> AsyncClient:
    clear_settings_cache()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Lifespan is entered via ASGI transport automatically for httpx>=0.27
        yield ac


@pytest.mark.asyncio
async def test_liveness(client: AsyncClient) -> None:
    response = await client.get("/health/live")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "uptime" in body
    assert "timestamp" in body


@pytest.mark.asyncio
async def test_unknown_route_error_envelope(client: AsyncClient) -> None:
    response = await client.get("/does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert "error" in body
    err = body["error"]
    assert err["code"] == "NOT_FOUND"
    assert err["statusCode"] == 404
    assert err["message"] == "Route not found"
    assert "requestId" in err

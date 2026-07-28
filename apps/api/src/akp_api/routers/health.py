"""Health probes — contract-compatible with the Fastify health routes."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from akp_api.deps import check_database, check_redis

router = APIRouter(tags=["health"])


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class LivenessResponse(CamelModel):
    status: Literal["ok"]
    uptime: float
    timestamp: str


class ReadinessChecks(CamelModel):
    database: Literal["up", "down"]
    redis: Literal["up", "down"]


class ReadinessResponse(CamelModel):
    status: Literal["ok", "degraded"]
    checks: ReadinessChecks
    timestamp: str


@router.get("/health/live", response_model=LivenessResponse)
async def liveness(request: Request) -> dict[str, Any]:
    started_at: float = getattr(request.app.state, "started_at", time.monotonic())
    return {
        "status": "ok",
        "uptime": round(time.monotonic() - started_at),
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


@router.get("/health/ready", response_model=ReadinessResponse)
async def readiness(request: Request) -> JSONResponse:
    container = request.app.state.container
    database = await check_database(container.engine)
    cache = await check_redis(container.redis)
    healthy = database == "up" and cache == "up"
    body = {
        "status": "ok" if healthy else "degraded",
        "checks": {"database": database, "redis": cache},
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    return JSONResponse(status_code=200 if healthy else 503, content=body)

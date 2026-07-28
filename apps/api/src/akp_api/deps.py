"""Dependency health checks shared by readiness probe."""

from __future__ import annotations

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


async def check_database(engine: AsyncEngine) -> str:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "up"
    except Exception:
        return "down"


async def check_redis(redis: Redis[str]) -> str:
    try:
        return "up" if await redis.ping() else "down"
    except Exception:
        return "down"

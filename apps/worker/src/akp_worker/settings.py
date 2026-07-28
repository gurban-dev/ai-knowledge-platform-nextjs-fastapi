"""arq worker — Phase 0 stub (queues wired in Phase 4).

Queue choice: **arq** (not Celery). See docs/ARCHITECTURE.md for rationale —
fully async, Redis-native like BullMQ, no sync/async impedance mismatch with
FastAPI + async SQLAlchemy.
"""

from __future__ import annotations

from akp_config import get_settings
from akp_observability import configure_logging, get_logger
from arq import cron
from arq.connections import RedisSettings


async def startup(ctx: dict[str, object]) -> None:
    settings = get_settings()
    configure_logging(settings)
    ctx["settings"] = settings
    ctx["log"] = get_logger("akp.worker")
    ctx["log"].info("worker.startup", queue_prefix=settings.QUEUE_PREFIX)  # type: ignore[attr-defined]


async def shutdown(ctx: dict[str, object]) -> None:
    log = ctx.get("log")
    if log is not None:
        log.info("worker.shutdown")  # type: ignore[attr-defined]


async def ping(ctx: dict[str, object]) -> dict[str, str]:
    """Smoke-test job used by Phase 0 health checks."""
    return {"status": "ok"}


async def retention_sweep(ctx: dict[str, object]) -> None:
    """Placeholder — implemented in Phase 4 / 7."""
    settings = ctx["settings"]
    if not getattr(settings, "RETENTION_SWEEP_ENABLED", False):
        return
    log = ctx["log"]
    log.info("retention_sweep.skipped", reason="not_implemented")  # type: ignore[attr-defined]


def build_worker_settings() -> type:
    """Bind Redis/queue from env onto an arq WorkerSettings class."""
    settings = get_settings()

    class WorkerSettings:
        functions = [ping, retention_sweep]
        on_startup = startup
        on_shutdown = shutdown
        cron_jobs = [cron(retention_sweep, hour={3}, minute={0})]
        redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
        queue_name = f"{settings.QUEUE_PREFIX}:default"
        max_tries = 5
        job_timeout = 600
        keep_result = 3_600
        # BullMQ used exponential backoff starting at 2000ms; arq retries with
        # retry_jobs=True and increasing delay via job deferral in Phase 4.
        retry_jobs = True

    return WorkerSettings


# Default export for `arq apps.worker...` style discovery after env is loaded.
WorkerSettings = build_worker_settings

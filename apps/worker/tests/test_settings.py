"""Worker settings smoke test."""

from __future__ import annotations

import os

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

from akp_config import clear_settings_cache
from akp_worker.settings import build_worker_settings


def test_worker_settings_queue_name() -> None:
    clear_settings_cache()
    settings_cls = build_worker_settings()
    assert settings_cls.queue_name.startswith("akp:")
    assert settings_cls.max_tries == 5

"""Pydantic Settings — fail-fast env validation analogous to ``@akp/config``."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _csv(value: str | list[str]) -> list[str]:
    if isinstance(value, list):
        return value
    return [part.strip() for part in value.split(",") if part.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "production"] = "development"
    LOG_LEVEL: Literal["fatal", "error", "warn", "info", "debug", "trace", "silent"] = "info"

    API_HOST: str = "0.0.0.0"
    API_PORT: int = Field(default=4000, ge=1, le=65535)
    API_PUBLIC_URL: str = "http://localhost:4000"
    # Comma-separated in .env (same as Node); NoDecode prevents JSON parsing.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    DATABASE_URL: str
    TEST_DATABASE_URL: str | None = None

    REDIS_URL: str

    JWT_ACCESS_SECRET: str = Field(min_length=32)
    JWT_REFRESH_SECRET: str = Field(min_length=32)
    JWT_ACCESS_TTL: int = 900
    JWT_REFRESH_TTL: int = 2_592_000
    JWT_ISSUER: str = "akp"
    JWT_AUDIENCE: str = "akp-api"
    PASSWORD_HASH_MEMORY_COST: int = Field(default=19_456, ge=8192)

    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    EMBEDDING_MODEL: str = "text-embedding-3-large"
    EMBEDDING_DIMENSIONS: int = 1536
    CHAT_MODEL: str = "gpt-4o"
    AI_FORCE_FAKE: bool = False
    RETRIEVAL_VECTOR_K: int = 40
    RETRIEVAL_LEXICAL_K: int = 40
    RETRIEVAL_RERANK_K: int = 8
    RETRIEVAL_MIN_SCORE: float = 0.12
    GROUNDING_MIN_CONFIDENCE: float = 0.35

    STORAGE_BACKEND: Literal["local", "gcs"] = "local"
    STORAGE_LOCAL_ROOT: str = ".data/objects"
    STORAGE_BUCKET: str = "akp-documents"
    STORAGE_GCS_ACCESS_TOKEN: str | None = None

    QUEUE_PREFIX: str = "akp"
    INGEST_CONCURRENCY: int = 4
    WEBHOOK_CONCURRENCY: int = 8

    STRIPE_SECRET_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None

    WEB_PUBLIC_URL: str = "http://localhost:3000"
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None

    MCP_HOST: str = "0.0.0.0"
    MCP_PORT: int = Field(default=4100, ge=1, le=65535)

    OTEL_ENABLED: bool = False
    OTEL_EXPORTER_OTLP_ENDPOINT: str | None = None
    OTEL_SERVICE_NAME: str = "akp-api"
    SENTRY_DSN: str | None = None

    SECURITY_REQUIRE_MFA: bool = False
    SECURITY_ALLOW_SSO: bool = True
    SECURITY_API_KEY_RETENTION_DAYS: int = 365
    INCIDENT_RUNBOOK_URL: str = "https://example.com/runbooks/akp"
    INCIDENT_CHANNEL: str = "#akp-incident-response"
    BACKUP_PROVIDER: str | None = None
    BACKUP_LAST_RESTORE_TEST_AT: str | None = None

    SLO_AVAILABILITY_TARGET: str = "99.9%"
    SLO_LATENCY_BUDGET_MS: int = 750
    SLO_ERROR_BUDGET_MINUTES: int = 43
    SLO_BURN_ALERT: str = "burn-rate > 14.4 over 1h"

    ENCRYPTION_ACTIVE_KEY_ID: str = "dev"
    ENCRYPTION_KEYS: str = "dev:YWtwLWRldi1lbmNyeXB0aW9uLWtleS0wMDAwMDAwMDE="

    MFA_ISSUER: str = "AKP"
    WEBHOOK_MAX_ATTEMPTS: int = Field(default=6, ge=1, le=20)
    WEBHOOK_TIMEOUT_MS: int = 5_000
    IDEMPOTENCY_TTL_SECONDS: int = 86_400
    RETENTION_SWEEP_ENABLED: bool = False

    RATE_LIMIT_MAX: int = 300
    RATE_LIMIT_WINDOW: int = 60_000
    API_KEY_RATE_LIMIT_PER_MINUTE: int = 120

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors(cls, value: object) -> list[str]:
        if value is None:
            return ["http://localhost:3000"]
        if isinstance(value, list):
            return [str(v) for v in value]
        return _csv(str(value))

    @field_validator(
        "AI_FORCE_FAKE",
        "OTEL_ENABLED",
        "SECURITY_REQUIRE_MFA",
        "SECURITY_ALLOW_SSO",
        "RETENTION_SWEEP_ENABLED",
        mode="before",
    )
    @classmethod
    def parse_bool(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        return str(value).lower() in {"1", "true", "yes", "on"}

    @model_validator(mode="after")
    def reject_weak_secrets_in_production(self) -> Settings:
        if self.NODE_ENV == "production":
            weak = ("change-me", "dev-access-secret", "dev-refresh-secret")
            for secret in (self.JWT_ACCESS_SECRET, self.JWT_REFRESH_SECRET):
                if any(token in secret for token in weak):
                    raise ValueError("Weak JWT secrets are not allowed in production")
        return self

    @property
    def async_database_url(self) -> str:
        """SQLAlchemy async URL (asyncpg). Strips Prisma ``?schema=`` query if present."""
        url = self.DATABASE_URL
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://") :]
        elif url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://") :]
        # Prisma uses ?schema=public; asyncpg does not accept that query param.
        if "?" in url:
            base, query = url.split("?", 1)
            parts = [p for p in query.split("&") if not p.startswith("schema=")]
            url = base if not parts else f"{base}?{'&'.join(parts)}"
        return url

    @property
    def google_oauth_enabled(self) -> bool:
        return bool(self.GOOGLE_CLIENT_ID and self.GOOGLE_CLIENT_SECRET)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


def clear_settings_cache() -> None:
    get_settings.cache_clear()

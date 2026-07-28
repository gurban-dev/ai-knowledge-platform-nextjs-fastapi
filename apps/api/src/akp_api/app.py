"""FastAPI application factory — Phase 0: health + error envelope."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from akp_config import Settings, get_settings
from akp_core import (
    AppError,
    IdPrefix,
    NotFoundError,
    RateLimitError,
    ValidationError,
    new_id,
    to_app_error,
)
from akp_db import create_engine, create_session_factory
from akp_observability import configure_logging, get_logger
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException

from akp_api.routers import auth, health

_STARTED_AT = time.monotonic()


class AppState:
    """Composition root held on ``app.state``."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.engine: AsyncEngine = create_engine(settings)
        self.session_factory: async_sessionmaker[AsyncSession] = create_session_factory(
            self.engine
        )
        self.redis: Redis[str] = Redis.from_url(settings.REDIS_URL, decode_responses=True)


def serialize_error(error: AppError, request_id: str) -> dict[str, Any]:
    base = error.to_serialized()
    message = base.message if error.expose else "An unexpected error occurred"
    details = base.details if error.expose else None
    body: dict[str, Any] = {
        "code": base.code.value,
        "message": message,
        "statusCode": base.status_code,
        "requestId": request_id,
    }
    if details is not None:
        body["details"] = details
    return {"error": body}


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()
    configure_logging(cfg)
    log = get_logger("akp.api")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        state = AppState(cfg)
        app.state.container = state
        log.info("api.startup", port=cfg.API_PORT)
        try:
            yield
        finally:
            await state.redis.close()
            await state.engine.dispose()
            log.info("api.shutdown")

    app = FastAPI(
        title="AI Knowledge Platform API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/docs/json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next: Any) -> Any:
        request_id = request.headers.get("x-request-id") or new_id(IdPrefix.session).replace(
            "ses_", "req_"
        )
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "req_unknown")
        body = serialize_error(exc, request_id)
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = []
        for err in exc.errors():
            loc = err.get("loc", ())
            # Skip "body" / "query" prefix to match Zod JSON-pointer style paths.
            parts = [str(p) for p in loc if p not in {"body", "query", "path", "header"}]
            details.append({"path": "/" + "/".join(parts), "message": err.get("msg", "Invalid")})
        app_err = ValidationError("Request validation failed", details)
        request_id = getattr(request.state, "request_id", "req_unknown")
        return JSONResponse(
            status_code=app_err.status_code,
            content=serialize_error(app_err, request_id),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "req_unknown")
        if exc.status_code == 404:
            err: AppError = NotFoundError("Route")
        elif exc.status_code == 429:
            err = RateLimitError()
        else:
            err = to_app_error(exc)
            err = AppError(
                code=err.code,
                message=str(exc.detail) if exc.detail else err.message,
                status_code=exc.status_code,
                expose=exc.status_code < 500,
            )
        return JSONResponse(status_code=err.status_code, content=serialize_error(err, request_id))

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", error=str(exc))
        app_err = to_app_error(exc)
        request_id = getattr(request.state, "request_id", "req_unknown")
        return JSONResponse(
            status_code=app_err.status_code,
            content=serialize_error(app_err, request_id),
        )

    app.include_router(health.router)
    app.include_router(auth.router)

    # Expose uptime helper for health router
    app.state.started_at = _STARTED_AT

    return app

"""FastAPI dependencies: DB session, JWT, Bearer auth."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from akp_config import get_settings
from akp_core import UnauthorizedError
from akp_core.rbac import role_satisfies
from akp_db.enums import Role
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from akp_api.lib.jwt_service import JwtService


@dataclass(slots=True)
class AuthContext:
    user_id: str
    organization_id: str
    role: Role
    session_id: str


async def get_db_session(request: Request) -> AsyncIterator[AsyncSession]:
    container = request.app.state.container
    session = container.session_factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


def get_jwt_service() -> JwtService:
    settings = get_settings()
    return JwtService(
        secret=settings.JWT_ACCESS_SECRET,
        issuer=settings.JWT_ISSUER,
        audience=settings.JWT_AUDIENCE,
        access_ttl_seconds=settings.JWT_ACCESS_TTL,
    )


def _extract_bearer(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if not header:
        return None
    parts = header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        return None
    return parts[1].strip()


async def get_current_auth(
    request: Request,
    jwt: Annotated[JwtService, Depends(get_jwt_service)],
) -> AuthContext:
    token = _extract_bearer(request)
    if not token:
        raise UnauthorizedError("Missing or malformed Authorization header")
    claims = jwt.verify_access_token(token)
    return AuthContext(
        user_id=claims.sub,
        organization_id=claims.org,
        role=Role(claims.role),
        session_id=claims.sid,
    )


def require_role(minimum: Role) -> object:
    async def _checker(auth: Annotated[AuthContext, Depends(get_current_auth)]) -> AuthContext:
        from akp_core import ForbiddenError

        if not role_satisfies(auth.role, minimum):
            raise ForbiddenError("Insufficient role for this action")
        return auth

    return _checker

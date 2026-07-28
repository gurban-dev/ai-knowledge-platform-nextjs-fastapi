"""Auth HTTP routes — /v1/auth/* contract-compatible with Fastify."""

from __future__ import annotations

from typing import Annotated

from akp_config import get_settings
from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from akp_api.deps_auth import AuthContext, get_current_auth, get_db_session, get_jwt_service
from akp_api.lib.jwt_service import JwtService
from akp_api.schemas.auth import (
    AuthResult,
    LoginBody,
    LogoutBody,
    ProfileOut,
    RefreshBody,
    RegisterBody,
)
from akp_api.services.auth import AuthService, RequestMeta

router = APIRouter(prefix="/v1/auth", tags=["auth"])


def _meta(request: Request) -> RequestMeta:
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    return RequestMeta(ip_address=ip, user_agent=request.headers.get("user-agent"))


def _auth_service(session: AsyncSession, jwt: JwtService) -> AuthService:
    settings = get_settings()
    return AuthService(
        session,
        jwt,
        access_ttl=settings.JWT_ACCESS_TTL,
        refresh_ttl=settings.JWT_REFRESH_TTL,
        password_hash_memory_cost=settings.PASSWORD_HASH_MEMORY_COST,
    )


@router.post("/register", response_model=AuthResult, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterBody,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    jwt: Annotated[JwtService, Depends(get_jwt_service)],
) -> AuthResult:
    service = _auth_service(session, jwt)
    return await service.register(
        email=body.email,
        password=body.password,
        name=body.name,
        organization_name=body.organization_name,
        meta=_meta(request),
    )


@router.post("/login", response_model=AuthResult)
async def login(
    body: LoginBody,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    jwt: Annotated[JwtService, Depends(get_jwt_service)],
) -> AuthResult:
    service = _auth_service(session, jwt)
    return await service.login(
        email=body.email,
        password=body.password,
        mfa_token=body.mfa_token,
        recovery_code=body.recovery_code,
        meta=_meta(request),
    )


@router.post("/refresh", response_model=AuthResult)
async def refresh(
    body: RefreshBody,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    jwt: Annotated[JwtService, Depends(get_jwt_service)],
) -> AuthResult:
    service = _auth_service(session, jwt)
    return await service.refresh(body.refresh_token, _meta(request))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def logout(
    body: LogoutBody,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    jwt: Annotated[JwtService, Depends(get_jwt_service)],
) -> Response:
    service = _auth_service(session, jwt)
    await service.logout(body.refresh_token, _meta(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=ProfileOut)
async def me(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    jwt: Annotated[JwtService, Depends(get_jwt_service)],
) -> ProfileOut:
    service = _auth_service(session, jwt)
    return await service.get_profile(auth.user_id)

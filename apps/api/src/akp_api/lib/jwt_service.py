"""JWT access + MFA-pending tokens — parity with apps/api-node/src/lib/jwt.ts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from akp_core import ErrorCode, UnauthorizedError


class TokenExpiredError(UnauthorizedError):
    def __init__(self, message: str = "Access token has expired") -> None:
        super().__init__(message, ErrorCode.TOKEN_EXPIRED)


class TokenInvalidError(UnauthorizedError):
    def __init__(self, message: str = "Access token is invalid") -> None:
        super().__init__(message, ErrorCode.TOKEN_INVALID)


class InvalidCredentialsError(UnauthorizedError):
    def __init__(self, message: str = "Invalid email or password") -> None:
        super().__init__(message, ErrorCode.INVALID_CREDENTIALS)


@dataclass(frozen=True, slots=True)
class AccessTokenClaims:
    sub: str
    org: str
    role: str
    sid: str


@dataclass(frozen=True, slots=True)
class MfaPendingClaims:
    sub: str
    purpose: str = "mfa_pending"


MFA_PENDING_TTL_SECONDS = 300


class JwtService:
    def __init__(
        self,
        *,
        secret: str,
        issuer: str,
        audience: str,
        access_ttl_seconds: int,
    ) -> None:
        self._secret = secret
        self._issuer = issuer
        self._audience = audience
        self._access_ttl = access_ttl_seconds

    def sign_access_token(self, claims: AccessTokenClaims) -> str:
        now = datetime.now(UTC)
        payload: dict[str, Any] = {
            "sub": claims.sub,
            "org": claims.org,
            "role": claims.role,
            "sid": claims.sid,
            "iss": self._issuer,
            "aud": self._audience,
            "iat": now,
            "exp": now + timedelta(seconds=self._access_ttl),
        }
        return jwt.encode(payload, self._secret, algorithm="HS256")

    def verify_access_token(self, token: str) -> AccessTokenClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                issuer=self._issuer,
                audience=self._audience,
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenExpiredError() from exc
        except jwt.InvalidTokenError as exc:
            raise TokenInvalidError() from exc

        if payload.get("purpose") == "mfa_pending":
            raise TokenInvalidError("MFA pending token is not an access token")
        sub = payload.get("sub")
        org = payload.get("org")
        role = payload.get("role")
        sid = payload.get("sid")
        if not isinstance(sub, str) or not isinstance(org, str):
            raise TokenInvalidError("Access token is missing required claims")
        if not isinstance(role, str) or not isinstance(sid, str):
            raise TokenInvalidError("Access token is missing required claims")
        return AccessTokenClaims(sub=sub, org=org, role=role, sid=sid)

    def sign_mfa_pending_token(self, user_id: str) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": user_id,
            "purpose": "mfa_pending",
            "iss": self._issuer,
            "aud": f"{self._audience}:mfa",
            "iat": now,
            "exp": now + timedelta(seconds=MFA_PENDING_TTL_SECONDS),
        }
        return jwt.encode(payload, self._secret, algorithm="HS256")

    def verify_mfa_pending_token(self, token: str) -> MfaPendingClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                issuer=self._issuer,
                audience=f"{self._audience}:mfa",
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenExpiredError("MFA challenge has expired; sign in again") from exc
        except jwt.InvalidTokenError as exc:
            raise TokenInvalidError("MFA pending token is invalid") from exc

        if not isinstance(payload.get("sub"), str) or payload.get("purpose") != "mfa_pending":
            raise TokenInvalidError("MFA pending token is invalid")
        return MfaPendingClaims(sub=payload["sub"])

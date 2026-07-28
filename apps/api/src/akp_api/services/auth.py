"""Auth service — register / login / refresh / logout / me (Phase 2 core)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from akp_core import (
    ConflictError,
    ErrorCode,
    ForbiddenError,
    IdPrefix,
    MfaRequiredError,
    UnauthorizedError,
    new_id,
)
from akp_db.enums import MembershipStatus, OrganizationStatus, Role, UserStatus
from akp_db.models import AuditLog, Membership, Organization, Session, User
from akp_observability import get_logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from akp_api.lib.crypto import (
    generate_opaque_token,
    hash_password,
    hash_token,
    verify_password,
)
from akp_api.lib.jwt_service import (
    AccessTokenClaims,
    InvalidCredentialsError,
    JwtService,
    TokenExpiredError,
    TokenInvalidError,
)
from akp_api.schemas.auth import AuthResult, ProfileOut, PublicOrganization, PublicUser, TokensOut

log = get_logger("akp.auth")

# Precomputed argon2id decoy for constant-time login when user is missing.
_DECOY_HASH = (
    "$argon2id$v=19$m=19456,t=3,p=1$c29tZXNhbHRzb21lc2FsdA$0Xk9Yb0m6Qm0Qm0Qm0Qm0Qm0Qm0Qm0Qm0Qm0Qm0Q"
)


@dataclass(slots=True)
class RequestMeta:
    ip_address: str | None = None
    user_agent: str | None = None


def slugify(input_value: str) -> str:
    slug = unicodedata.normalize("NFKD", input_value).encode("ascii", "ignore").decode("ascii")
    slug = slug.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")[:48]
    return slug or "org"


class AuthService:
    def __init__(
        self,
        session: AsyncSession,
        jwt: JwtService,
        *,
        access_ttl: int,
        refresh_ttl: int,
        password_hash_memory_cost: int,
    ) -> None:
        self._db = session
        self._jwt = jwt
        self._access_ttl = access_ttl
        self._refresh_ttl = refresh_ttl
        self._memory_cost = password_hash_memory_cost

    async def register(
        self,
        *,
        email: str,
        password: str,
        name: str,
        organization_name: str,
        meta: RequestMeta,
    ) -> AuthResult:
        email = email.lower()
        existing = await self._db.scalar(select(User).where(User.email == email))
        if existing:
            raise ConflictError(
                "An account with this email already exists",
                ErrorCode.ALREADY_EXISTS,
            )

        password_hash = hash_password(password, self._memory_cost)
        organization, user = await self._provision_owner(
            email=email,
            name=name,
            organization_name=organization_name,
            password_hash=password_hash,
            meta=meta,
        )
        tokens = await self._issue_session(user, organization, Role.OWNER, meta)
        return self._build_result(user, organization, Role.OWNER, tokens)

    async def login(
        self,
        *,
        email: str,
        password: str,
        mfa_token: str | None,
        recovery_code: str | None,
        meta: RequestMeta,
    ) -> AuthResult:
        user = await self._db.scalar(select(User).where(User.email == email.lower()))
        if user and user.password_hash:
            password_ok = verify_password(user.password_hash, password)
        else:
            verify_password(_DECOY_HASH, password)
            password_ok = False

        if not user or not user.password_hash or not password_ok:
            log.warn("login_failed", email=email)
            raise InvalidCredentialsError()

        if user.mfa_enabled and (mfa_token or recovery_code):
            # Full MFA verify lands with MFA module; for now require challenge flow.
            raise MfaRequiredError("Multi-factor authentication required")

        return await self._finish_login(user, meta)

    async def refresh(self, refresh_token: str, meta: RequestMeta) -> AuthResult:
        token_hash = hash_token(refresh_token)
        session = await self._db.scalar(select(Session).where(Session.token_hash == token_hash))
        if not session:
            raise TokenInvalidError("Refresh token is invalid")

        if session.revoked_at is not None:
            await self._revoke_all_for_user(session.user_id)
            log.error("refresh_reuse_detected", user_id=session.user_id)
            raise TokenInvalidError("Refresh token has already been used")

        if session.expires_at <= datetime.now(UTC).replace(tzinfo=None):
            raise TokenExpiredError("Refresh token has expired")

        user = await self._db.scalar(select(User).where(User.id == session.user_id))
        if not user:
            raise TokenInvalidError("Refresh token is invalid")

        membership, organization = await self._resolve_active_membership(user.id)
        tokens, new_sid = await self._issue_session_with_id(
            user, organization, membership.role, meta
        )
        session.revoked_at = datetime.now(UTC).replace(tzinfo=None)
        session.replaced_by_id = new_sid
        await self._audit(
            organization.id,
            user.id,
            "auth.token_refreshed",
            resource_type="session",
            meta=meta,
        )
        await self._db.flush()
        return self._build_result(user, organization, membership.role, tokens)

    async def logout(self, refresh_token: str, meta: RequestMeta) -> None:
        session = await self._db.scalar(
            select(Session).where(Session.token_hash == hash_token(refresh_token))
        )
        if not session or session.revoked_at is not None:
            return
        session.revoked_at = datetime.now(UTC).replace(tzinfo=None)
        membership = await self._db.scalar(
            select(Membership).where(
                Membership.user_id == session.user_id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
        if membership:
            await self._audit(
                membership.organization_id,
                session.user_id,
                "auth.logged_out",
                resource_type="session",
                resource_id=session.id,
                meta=meta,
            )
        await self._db.flush()

    async def get_profile(self, user_id: str) -> ProfileOut:
        user = await self._db.scalar(select(User).where(User.id == user_id))
        if not user:
            raise UnauthorizedError("Account no longer exists")
        membership, organization = await self._resolve_active_membership(user_id)
        return ProfileOut(
            user=self._public_user(user),
            organization=self._public_org(organization),
            role=membership.role.value,
        )

    async def _finish_login(self, user: User, meta: RequestMeta) -> AuthResult:
        membership, organization = await self._resolve_active_membership(user.id)
        if user.mfa_enabled:
            await self._audit(
                organization.id,
                user.id,
                "auth.mfa_challenged",
                resource_type="session",
                meta=meta,
            )
            mfa_token = self._jwt.sign_mfa_pending_token(user.id)
            raise MfaRequiredError(
                "Multi-factor authentication required",
                details={"mfaToken": mfa_token},
            )

        user.last_login_at = datetime.now(UTC).replace(tzinfo=None)
        tokens = await self._issue_session(user, organization, membership.role, meta)
        await self._audit(
            organization.id,
            user.id,
            "auth.login_succeeded",
            resource_type="session",
            meta=meta,
        )
        await self._db.flush()
        return self._build_result(user, organization, membership.role, tokens)

    async def _provision_owner(
        self,
        *,
        email: str,
        name: str,
        organization_name: str,
        password_hash: str | None,
        meta: RequestMeta,
        google_sub: str | None = None,
        avatar_url: str | None = None,
    ) -> tuple[Organization, User]:
        slug = await self._allocate_slug(organization_name)
        now = datetime.now(UTC).replace(tzinfo=None)
        organization = Organization(
            id=new_id(IdPrefix.organization),
            name=organization_name,
            slug=slug,
            status=OrganizationStatus.ACTIVE,
            settings={},
            created_at=now,
            updated_at=now,
        )
        user = User(
            id=new_id(IdPrefix.user),
            email=email,
            password_hash=password_hash,
            google_sub=google_sub,
            name=name,
            status=UserStatus.ACTIVE,
            avatar_url=avatar_url,
            mfa_enabled=False,
            mfa_recovery_codes=[],
            created_at=now,
            updated_at=now,
        )
        self._db.add(organization)
        self._db.add(user)
        await self._db.flush()
        membership = Membership(
            id=new_id(IdPrefix.membership),
            organization_id=organization.id,
            user_id=user.id,
            role=Role.OWNER,
            status=MembershipStatus.ACTIVE,
            created_at=now,
            updated_at=now,
        )
        self._db.add(membership)
        await self._db.flush()
        await self._audit(
            organization.id,
            user.id,
            "organization.created",
            resource_type="organization",
            resource_id=organization.id,
            meta=meta,
        )
        await self._audit(
            organization.id,
            user.id,
            "user.registered",
            resource_type="user",
            resource_id=user.id,
            meta=meta,
        )
        return organization, user

    async def _issue_session(
        self,
        user: User,
        organization: Organization,
        role: Role,
        meta: RequestMeta,
    ) -> TokensOut:
        tokens, _session_id = await self._issue_session_with_id(user, organization, role, meta)
        return tokens

    async def _issue_session_with_id(
        self,
        user: User,
        organization: Organization,
        role: Role,
        meta: RequestMeta,
    ) -> tuple[TokensOut, str]:
        refresh_token = generate_opaque_token()
        session_id = new_id(IdPrefix.session)
        now = datetime.now(UTC).replace(tzinfo=None)
        session = Session(
            id=session_id,
            user_id=user.id,
            token_hash=hash_token(refresh_token),
            user_agent=meta.user_agent,
            ip_address=meta.ip_address,
            expires_at=now + timedelta(seconds=self._refresh_ttl),
            created_at=now,
        )
        self._db.add(session)
        await self._db.flush()
        access_token = self._jwt.sign_access_token(
            AccessTokenClaims(
                sub=user.id,
                org=organization.id,
                role=role.value,
                sid=session_id,
            )
        )
        tokens = TokensOut(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=self._access_ttl,
            token_type="Bearer",
        )
        return tokens, session_id

    async def _allocate_slug(self, organization_name: str) -> str:
        base = slugify(organization_name)

        def suffix(n: int) -> str:
            return re.sub(r"[^a-z0-9]", "", generate_opaque_token(n).lower())[:6]

        for attempt in range(5):
            candidate = base if attempt == 0 else f"{base}-{suffix(4)}"
            exists = await self._db.scalar(select(Organization.id).where(Organization.slug == candidate))
            if not exists:
                return candidate
        return f"{base}-{suffix(8)}"

    async def _resolve_active_membership(self, user_id: str) -> tuple[Membership, Organization]:
        row = await self._db.execute(
            select(Membership, Organization)
            .join(Organization, Organization.id == Membership.organization_id)
            .where(
                Membership.user_id == user_id,
                Membership.status == MembershipStatus.ACTIVE,
            )
            .limit(1)
        )
        result = row.first()
        if not result:
            raise ForbiddenError("User is not an active member of any organization")
        return result[0], result[1]

    async def _revoke_all_for_user(self, user_id: str) -> None:
        sessions = (
            await self._db.scalars(
                select(Session).where(Session.user_id == user_id, Session.revoked_at.is_(None))
            )
        ).all()
        now = datetime.now(UTC).replace(tzinfo=None)
        for session in sessions:
            session.revoked_at = now
        await self._db.flush()

    async def _audit(
        self,
        organization_id: str,
        actor_user_id: str | None,
        action: str,
        *,
        resource_type: str | None = None,
        resource_id: str | None = None,
        meta: RequestMeta,
    ) -> None:
        self._db.add(
            AuditLog(
                id=new_id(IdPrefix.audit_log),
                organization_id=organization_id,
                actor_user_id=actor_user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                ip_address=meta.ip_address,
                user_agent=meta.user_agent,
                metadata_={},
                created_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )

    @staticmethod
    def _public_user(user: User) -> PublicUser:
        return PublicUser(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
        )

    @staticmethod
    def _public_org(organization: Organization) -> PublicOrganization:
        return PublicOrganization(
            id=organization.id,
            name=organization.name,
            slug=organization.slug,
        )

    def _build_result(
        self,
        user: User,
        organization: Organization,
        role: Role,
        tokens: TokensOut,
    ) -> AuthResult:
        return AuthResult(
            user=self._public_user(user),
            organization=self._public_org(organization),
            role=role.value,
            tokens=tokens,
        )

"""Unit tests for JWT + password helpers."""

from __future__ import annotations

import pytest
from akp_api.lib.crypto import generate_opaque_token, hash_password, hash_token, verify_password
from akp_api.lib.jwt_service import AccessTokenClaims, JwtService, TokenInvalidError


def test_password_roundtrip() -> None:
    hashed = hash_password("Password123!", 8192)
    assert verify_password(hashed, "Password123!")
    assert not verify_password(hashed, "wrong")


def test_opaque_token_hash() -> None:
    token = generate_opaque_token()
    assert len(hash_token(token)) == 64


def test_jwt_roundtrip() -> None:
    jwt = JwtService(
        secret="test-access-secret-000000000000000000000",
        issuer="akp",
        audience="akp-api",
        access_ttl_seconds=900,
    )
    token = jwt.sign_access_token(
        AccessTokenClaims(sub="usr_1", org="org_1", role="OWNER", sid="ses_1")
    )
    claims = jwt.verify_access_token(token)
    assert claims.sub == "usr_1"
    assert claims.org == "org_1"
    assert claims.role == "OWNER"
    assert claims.sid == "ses_1"


def test_mfa_pending_rejected_as_access() -> None:
    jwt = JwtService(
        secret="test-access-secret-000000000000000000000",
        issuer="akp",
        audience="akp-api",
        access_ttl_seconds=900,
    )
    pending = jwt.sign_mfa_pending_token("usr_1")
    with pytest.raises(TokenInvalidError):
        jwt.verify_access_token(pending)

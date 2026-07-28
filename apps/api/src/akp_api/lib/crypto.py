"""Password and opaque-token crypto — parity with apps/api-node/src/lib/crypto.ts."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError


def hash_password(password: str, memory_cost: int) -> str:
    hasher = PasswordHasher(time_cost=3, memory_cost=memory_cost, parallelism=1)
    return hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    hasher = PasswordHasher()
    try:
        return hasher.verify(password_hash, password)
    except (VerifyMismatchError, Exception):
        return False


def generate_opaque_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def safe_compare_hex(a: str, b: str) -> bool:
    try:
        return hmac.compare_digest(bytes.fromhex(a), bytes.fromhex(b))
    except ValueError:
        return False

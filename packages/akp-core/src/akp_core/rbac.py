"""RBAC helpers — contract-compatible with ``@akp/core`` rbac."""

from __future__ import annotations

from akp_db.enums import Role

ROLE_RANK: dict[Role, int] = {
    Role.VIEWER: 0,
    Role.MEMBER: 1,
    Role.ADMIN: 2,
    Role.OWNER: 3,
}

ALL_ROLES: tuple[Role, ...] = (Role.VIEWER, Role.MEMBER, Role.ADMIN, Role.OWNER)


def role_satisfies(role: Role | str, required: Role | str) -> bool:
    return ROLE_RANK[Role(role)] >= ROLE_RANK[Role(required)]

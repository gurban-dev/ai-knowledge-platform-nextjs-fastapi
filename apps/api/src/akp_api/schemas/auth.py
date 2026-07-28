"""Auth request/response schemas — camelCase JSON to match the Fastify contract."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


_PASSWORD_LOWER = re.compile(r"[a-z]")
_PASSWORD_UPPER = re.compile(r"[A-Z]")
_PASSWORD_DIGIT = re.compile(r"[0-9]")


class RegisterBody(CamelModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    name: str = Field(min_length=1, max_length=120)
    organization_name: str = Field(min_length=2, max_length=120)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("name", "organization_name")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("password")
    @classmethod
    def password_complexity(cls, value: str) -> str:
        if not _PASSWORD_LOWER.search(value):
            raise ValueError("Password must contain a lowercase letter")
        if not _PASSWORD_UPPER.search(value):
            raise ValueError("Password must contain an uppercase letter")
        if not _PASSWORD_DIGIT.search(value):
            raise ValueError("Password must contain a digit")
        return value


class LoginBody(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)
    mfa_token: str | None = Field(default=None, min_length=6, max_length=10)
    recovery_code: str | None = Field(default=None, min_length=6, max_length=20)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class RefreshBody(CamelModel):
    refresh_token: str = Field(min_length=1)


class LogoutBody(CamelModel):
    refresh_token: str = Field(min_length=1)


class TokensOut(CamelModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: Literal["Bearer"] = "Bearer"


class PublicUser(CamelModel):
    id: str
    email: str
    name: str
    avatar_url: str | None = None


class PublicOrganization(CamelModel):
    id: str
    name: str
    slug: str


class AuthResult(CamelModel):
    user: PublicUser
    organization: PublicOrganization
    role: str
    tokens: TokensOut


class ProfileOut(CamelModel):
    user: PublicUser
    organization: PublicOrganization
    role: str

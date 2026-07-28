"""Stable, machine-readable error codes and typed application errors.

These codes are part of the public API contract. Treat renames as breaking changes.
The HTTP envelope is always::

    {"error": {"code", "message", "statusCode", "details?", "requestId"}}
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    BAD_REQUEST = "BAD_REQUEST"
    UNAUTHORIZED = "UNAUTHORIZED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    TOKEN_INVALID = "TOKEN_INVALID"
    FORBIDDEN = "FORBIDDEN"
    INSUFFICIENT_ROLE = "INSUFFICIENT_ROLE"
    INSUFFICIENT_SCOPE = "INSUFFICIENT_SCOPE"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    ALREADY_EXISTS = "ALREADY_EXISTS"
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    RATE_LIMITED = "RATE_LIMITED"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE"
    MFA_REQUIRED = "MFA_REQUIRED"
    MFA_INVALID = "MFA_INVALID"
    PROMPT_INJECTION_DETECTED = "PROMPT_INJECTION_DETECTED"
    CONTENT_BLOCKED = "CONTENT_BLOCKED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    DEPENDENCY_FAILURE = "DEPENDENCY_FAILURE"
    ORGANIZATION_SUSPENDED = "ORGANIZATION_SUSPENDED"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    FEATURE_DISABLED = "FEATURE_DISABLED"
    ENCRYPTION_ERROR = "ENCRYPTION_ERROR"


@dataclass(slots=True)
class SerializedError:
    code: ErrorCode
    message: str
    status_code: int
    details: Any | None = None
    request_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code.value,
            "message": self.message,
            "statusCode": self.status_code,
        }
        if self.details is not None:
            payload["details"] = self.details
        if self.request_id is not None:
            payload["requestId"] = self.request_id
        return payload


class AppError(Exception):
    """Base class for deliberate, typed application errors."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        status_code: int,
        *,
        details: Any | None = None,
        cause: BaseException | None = None,
        expose: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        self.cause = cause
        self.expose = status_code < 500 if expose is None else expose

    def to_serialized(self) -> SerializedError:
        return SerializedError(
            code=self.code,
            message=self.message,
            status_code=self.status_code,
            details=self.details,
        )


class ValidationError(AppError):
    def __init__(self, message: str = "Validation failed", details: Any | None = None) -> None:
        super().__init__(ErrorCode.VALIDATION_ERROR, message, 422, details=details, expose=True)


class BadRequestError(AppError):
    def __init__(self, message: str = "Bad request", details: Any | None = None) -> None:
        super().__init__(ErrorCode.BAD_REQUEST, message, 400, details=details, expose=True)


class UnauthorizedError(AppError):
    def __init__(
        self,
        message: str = "Authentication required",
        code: ErrorCode = ErrorCode.UNAUTHORIZED,
    ) -> None:
        super().__init__(code, message, 401, expose=True)


class ForbiddenError(AppError):
    def __init__(
        self,
        message: str = "You do not have permission to perform this action",
        details: Any | None = None,
    ) -> None:
        super().__init__(ErrorCode.FORBIDDEN, message, 403, details=details, expose=True)


class NotFoundError(AppError):
    def __init__(self, resource: str = "Resource", details: Any | None = None) -> None:
        super().__init__(
            ErrorCode.NOT_FOUND,
            f"{resource} not found",
            404,
            details=details,
            expose=True,
        )


class ConflictError(AppError):
    def __init__(
        self,
        message: str = "Resource conflict",
        code: ErrorCode = ErrorCode.CONFLICT,
        details: Any | None = None,
    ) -> None:
        super().__init__(code, message, 409, details=details, expose=True)


class RateLimitError(AppError):
    def __init__(self, message: str = "Too many requests", details: Any | None = None) -> None:
        super().__init__(ErrorCode.RATE_LIMITED, message, 429, details=details, expose=True)


class QuotaExceededError(AppError):
    def __init__(self, message: str = "Plan quota exceeded", details: Any | None = None) -> None:
        super().__init__(ErrorCode.QUOTA_EXCEEDED, message, 402, details=details, expose=True)


class BudgetExceededError(AppError):
    def __init__(
        self,
        message: str = "Monthly AI spend cap exceeded",
        details: Any | None = None,
    ) -> None:
        super().__init__(ErrorCode.BUDGET_EXCEEDED, message, 402, details=details, expose=True)


class InsufficientScopeError(AppError):
    def __init__(
        self,
        message: str = "The credential lacks a required scope",
        details: Any | None = None,
    ) -> None:
        super().__init__(
            ErrorCode.INSUFFICIENT_SCOPE,
            message,
            403,
            details=details,
            expose=True,
        )


class FeatureDisabledError(AppError):
    def __init__(
        self,
        message: str = "This feature is disabled for your organization",
        details: Any | None = None,
    ) -> None:
        super().__init__(ErrorCode.FEATURE_DISABLED, message, 403, details=details, expose=True)


class MfaRequiredError(AppError):
    def __init__(
        self,
        message: str = "Multi-factor authentication required",
        details: Any | None = None,
    ) -> None:
        super().__init__(ErrorCode.MFA_REQUIRED, message, 401, details=details, expose=True)


class MfaInvalidError(AppError):
    def __init__(self, message: str = "Invalid multi-factor authentication code") -> None:
        super().__init__(ErrorCode.MFA_INVALID, message, 401, expose=True)


class IdempotencyConflictError(AppError):
    def __init__(self, message: str = "Idempotency key reused with a different request") -> None:
        super().__init__(ErrorCode.IDEMPOTENCY_CONFLICT, message, 409, expose=True)


class PromptInjectionError(AppError):
    def __init__(
        self,
        message: str = "Potential prompt injection detected in input",
        details: Any | None = None,
    ) -> None:
        super().__init__(
            ErrorCode.PROMPT_INJECTION_DETECTED,
            message,
            422,
            details=details,
            expose=True,
        )


class DependencyFailureError(AppError):
    def __init__(
        self,
        message: str = "A downstream dependency failed",
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(ErrorCode.DEPENDENCY_FAILURE, message, 502, cause=cause, expose=False)


class ServiceUnavailableError(AppError):
    def __init__(
        self,
        message: str = "Service temporarily unavailable",
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(ErrorCode.SERVICE_UNAVAILABLE, message, 503, cause=cause, expose=False)


class InternalError(AppError):
    def __init__(
        self,
        message: str = "An unexpected error occurred",
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(ErrorCode.INTERNAL_ERROR, message, 500, cause=cause, expose=False)


class EncryptionError(AppError):
    def __init__(
        self,
        message: str = "Failed to encrypt or decrypt data",
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(ErrorCode.ENCRYPTION_ERROR, message, 500, cause=cause, expose=False)


def to_app_error(err: object) -> AppError:
    if isinstance(err, AppError):
        return err
    if isinstance(err, BaseException):
        return InternalError(str(err) or "An unexpected error occurred", cause=err)
    return InternalError("An unexpected error occurred")

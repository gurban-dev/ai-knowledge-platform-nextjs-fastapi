"""Postgres enums — values match Prisma enum definitions exactly."""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"
    VIEWER = "VIEWER"


class OrganizationStatus(StrEnum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DELETED = "DELETED"


class UserStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INVITED = "INVITED"
    DISABLED = "DISABLED"


class MembershipStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INVITED = "INVITED"
    REVOKED = "REVOKED"


class ApiKeyStatus(StrEnum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"


class DataSourceType(StrEnum):
    UPLOAD = "UPLOAD"
    GOOGLE_DRIVE = "GOOGLE_DRIVE"
    NOTION = "NOTION"
    CONFLUENCE = "CONFLUENCE"
    GITHUB = "GITHUB"
    SLACK = "SLACK"
    WEB = "WEB"
    DATABASE = "DATABASE"
    API = "API"


class DataSourceStatus(StrEnum):
    CONNECTED = "CONNECTED"
    SYNCING = "SYNCING"
    ERROR = "ERROR"
    DISABLED = "DISABLED"


class DocumentStatus(StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    INDEXED = "INDEXED"
    FAILED = "FAILED"
    ARCHIVED = "ARCHIVED"


class JobType(StrEnum):
    INGEST_DOCUMENT = "INGEST_DOCUMENT"
    SYNC_SOURCE = "SYNC_SOURCE"
    REEMBED = "REEMBED"
    EVALUATE = "EVALUATE"


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class MessageRole(StrEnum):
    USER = "USER"
    ASSISTANT = "ASSISTANT"
    SYSTEM = "SYSTEM"
    TOOL = "TOOL"


class EvaluationStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class UsageKind(StrEnum):
    EMBEDDING = "EMBEDDING"
    CHAT_COMPLETION = "CHAT_COMPLETION"
    RERANK = "RERANK"


class WebhookEndpointStatus(StrEnum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"


class WebhookDeliveryStatus(StrEnum):
    PENDING = "PENDING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    DEAD = "DEAD"


class FeedbackRating(StrEnum):
    UP = "UP"
    DOWN = "DOWN"


class FeedbackReason(StrEnum):
    INCORRECT = "INCORRECT"
    INCOMPLETE = "INCOMPLETE"
    OUTDATED = "OUTDATED"
    UNSAFE = "UNSAFE"
    OTHER = "OTHER"


class IdempotencyStatus(StrEnum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class AclSubjectType(StrEnum):
    USER = "USER"
    TEAM = "TEAM"
    ROLE = "ROLE"


class AclPermission(StrEnum):
    READ = "READ"
    WRITE = "WRITE"
    ADMIN = "ADMIN"


class CollectionVisibility(StrEnum):
    PRIVATE = "PRIVATE"
    TEAM = "TEAM"
    ORGANIZATION = "ORGANIZATION"


class SsoProvider(StrEnum):
    OIDC = "OIDC"
    SAML = "SAML"


class SubscriptionStatus(StrEnum):
    TRIALING = "TRIALING"
    ACTIVE = "ACTIVE"
    PAST_DUE = "PAST_DUE"
    CANCELED = "CANCELED"
    SUSPENDED = "SUSPENDED"


class ToolSideEffect(StrEnum):
    READ = "READ"
    WRITE = "WRITE"
    DESTRUCTIVE = "DESTRUCTIVE"


class ToolInvocationStatus(StrEnum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    DENIED = "DENIED"

"""SQLAlchemy 2.0 models — column/table parity with Prisma schema."""

from __future__ import annotations

from datetime import datetime
from enum import Enum as PyEnum
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from akp_db import enums as E
from akp_db.base import Base


def _pg_enum(enum_cls: type[PyEnum], name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        values_callable=lambda members: [m.value for m in members],
        create_type=False,
    )


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    status: Mapped[E.OrganizationStatus] = mapped_column(
        _pg_enum(E.OrganizationStatus, "OrganizationStatus"),
        nullable=False,
        server_default=text("'ACTIVE'"),
    )
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)

    __table_args__ = (Index("organizations_status_idx", "status"),)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_sub: Mapped[str | None] = mapped_column(Text, nullable=True, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[E.UserStatus] = mapped_column(
        _pg_enum(E.UserStatus, "UserStatus"), nullable=False, server_default=text("'ACTIVE'")
    )
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    mfa_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_recovery_codes: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::TEXT[]"))
    mfa_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("users_status_idx", "status"),)


class Membership(Base):
    __tablename__ = "memberships"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[E.Role] = mapped_column(_pg_enum(E.Role, "Role"), nullable=False, server_default=text("'MEMBER'"))
    status: Mapped[E.MembershipStatus] = mapped_column(
        _pg_enum(E.MembershipStatus, "MembershipStatus"), nullable=False, server_default=text("'ACTIVE'")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="memberships_organization_id_user_id_key"),
        Index("memberships_user_id_idx", "user_id"),
        Index("memberships_organization_id_role_idx", "organization_id", "role"),
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    replaced_by_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("sessions_user_id_idx", "user_id"),
        Index("sessions_expires_at_idx", "expires_at"),
    )


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    prefix: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[E.ApiKeyStatus] = mapped_column(
        _pg_enum(E.ApiKeyStatus, "ApiKeyStatus"), nullable=False, server_default=text("'ACTIVE'")
    )
    scopes: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::TEXT[]"))
    rate_limit_per_minute: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ip_allowlist: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::TEXT[]"))
    created_by_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    last_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (Index("api_keys_organization_id_status_idx", "organization_id", "status"),)


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[E.Role] = mapped_column(_pg_enum(E.Role, "Role"), nullable=False, server_default=text("'MEMBER'"))
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    invited_by_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("organization_id", "email", name="invites_organization_id_email_key"),)


class DataSource(Base):
    __tablename__ = "data_sources"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[E.DataSourceType] = mapped_column(_pg_enum(E.DataSourceType, "DataSourceType"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[E.DataSourceStatus] = mapped_column(
        _pg_enum(E.DataSourceStatus, "DataSourceStatus"), nullable=False, server_default=text("'CONNECTED'")
    )
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    sync_cursor: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("data_sources_organization_id_status_idx", "organization_id", "status"),)


class StoredObject(Base):
    __tablename__ = "stored_objects"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    bucket: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    encrypted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "storage_key", name="stored_objects_organization_id_storage_key_key"),
        Index("stored_objects_organization_id_content_hash_idx", "organization_id", "content_hash"),
    )


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    data_source_id: Mapped[str | None] = mapped_column(Text, ForeignKey("data_sources.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    stored_object_id: Mapped[str | None] = mapped_column(Text, ForeignKey("stored_objects.id", ondelete="SET NULL"), nullable=True)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[E.DocumentStatus] = mapped_column(
        _pg_enum(E.DocumentStatus, "DocumentStatus"), nullable=False, server_default=text("'PENDING'")
    )
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    chunking_strategy: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'recursive-v1'"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("organization_id", "content_hash", name="documents_organization_id_content_hash_key"),
        Index("documents_organization_id_status_idx", "organization_id", "status"),
        Index("documents_data_source_id_idx", "data_source_id"),
        Index("documents_organization_id_deleted_at_idx", "organization_id", "deleted_at"),
    )


class DocumentVersion(Base):
    __tablename__ = "document_versions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, nullable=False)
    document_id: Mapped[str] = mapped_column(Text, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    stored_object_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("document_id", "version", name="document_versions_document_id_version_key"),
        Index("document_versions_organization_id_document_id_idx", "organization_id", "document_id"),
    )


class DocumentAcl(Base):
    __tablename__ = "document_acls"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(Text, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    subject_type: Mapped[E.AclSubjectType] = mapped_column(_pg_enum(E.AclSubjectType, "AclSubjectType"), nullable=False)
    subject_id: Mapped[str] = mapped_column(Text, nullable=False)
    permission: Mapped[E.AclPermission] = mapped_column(
        _pg_enum(E.AclPermission, "AclPermission"), nullable=False, server_default=text("'READ'")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("document_id", "subject_type", "subject_id", name="document_acls_document_id_subject_type_subject_id_key"),
        Index("document_acls_organization_id_subject_type_subject_id_idx", "organization_id", "subject_type", "subject_id"),
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, nullable=False)
    document_id: Mapped[str] = mapped_column(Text, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="document_chunks_document_id_chunk_index_key"),
        Index("document_chunks_organization_id_idx", "organization_id"),
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'New conversation'"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("conversations_organization_id_user_id_idx", "organization_id", "user_id"),
        Index("conversations_user_id_updated_at_idx", "user_id", "updated_at"),
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, nullable=False)
    conversation_id: Mapped[str] = mapped_column(Text, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[E.MessageRole] = mapped_column(_pg_enum(E.MessageRole, "MessageRole"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (Index("messages_conversation_id_created_at_idx", "conversation_id", "created_at"),)


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    message_id: Mapped[str] = mapped_column(Text, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    span_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    span_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("citations_message_id_idx", "message_id"),
        Index("citations_document_id_idx", "document_id"),
    )


class IngestionJob(Base):
    __tablename__ = "ingestion_jobs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[E.JobType] = mapped_column(_pg_enum(E.JobType, "JobType"), nullable=False)
    status: Mapped[E.JobStatus] = mapped_column(
        _pg_enum(E.JobStatus, "JobStatus"), nullable=False, server_default=text("'QUEUED'")
    )
    queue_job_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ingestion_jobs_organization_id_status_idx", "organization_id", "status"),
        Index("ingestion_jobs_type_status_idx", "type", "status"),
    )


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[E.EvaluationStatus] = mapped_column(
        _pg_enum(E.EvaluationStatus, "EvaluationStatus"), nullable=False, server_default=text("'PENDING'")
    )
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)

    __table_args__ = (Index("evaluations_organization_id_status_idx", "organization_id", "status"),)


class EvaluationResult(Base):
    __tablename__ = "evaluation_results"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    evaluation_id: Mapped[str] = mapped_column(Text, ForeignKey("evaluations.id", ondelete="CASCADE"), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    expected: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    scores: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    hallucinated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (Index("evaluation_results_evaluation_id_idx", "evaluation_id"),)


class UsageEvent(Base):
    __tablename__ = "usage_events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[E.UsageKind] = mapped_column(_pg_enum(E.UsageKind, "UsageKind"), nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    total_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    cost_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("usage_events_organization_id_created_at_idx", "organization_id", "created_at"),
        Index("usage_events_organization_id_kind_created_at_idx", "organization_id", "kind", "created_at"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    resource_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("audit_logs_organization_id_created_at_idx", "organization_id", "created_at"),
        Index("audit_logs_organization_id_action_created_at_idx", "organization_id", "action", "created_at"),
        Index("audit_logs_actor_user_id_idx", "actor_user_id"),
    )


class WebhookEndpoint(Base):
    __tablename__ = "webhook_endpoints"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    secret_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    events: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::TEXT[]"))
    status: Mapped[E.WebhookEndpointStatus] = mapped_column(
        _pg_enum(E.WebhookEndpointStatus, "WebhookEndpointStatus"), nullable=False, server_default=text("'ACTIVE'")
    )
    created_by_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("webhook_endpoints_organization_id_status_idx", "organization_id", "status"),)


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    endpoint_id: Mapped[str] = mapped_column(Text, ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    status: Mapped[E.WebhookDeliveryStatus] = mapped_column(
        _pg_enum(E.WebhookDeliveryStatus, "WebhookDeliveryStatus"), nullable=False, server_default=text("'PENDING'")
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("webhook_deliveries_organization_id_status_idx", "organization_id", "status"),
        Index("webhook_deliveries_status_next_attempt_at_idx", "status", "next_attempt_at"),
    )


class MessageFeedback(Base):
    __tablename__ = "message_feedback"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    message_id: Mapped[str] = mapped_column(Text, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    rating: Mapped[E.FeedbackRating] = mapped_column(_pg_enum(E.FeedbackRating, "FeedbackRating"), nullable=False)
    reason: Mapped[E.FeedbackReason | None] = mapped_column(_pg_enum(E.FeedbackReason, "FeedbackReason"), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="message_feedback_message_id_user_id_key"),
        Index("message_feedback_organization_id_rating_created_at_idx", "organization_id", "rating", "created_at"),
    )


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    method: Mapped[str] = mapped_column(Text, nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[E.IdempotencyStatus] = mapped_column(
        _pg_enum(E.IdempotencyStatus, "IdempotencyStatus"), nullable=False, server_default=text("'IN_PROGRESS'")
    )
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "key", name="idempotency_keys_organization_id_key_key"),
        Index("idempotency_keys_expires_at_idx", "expires_at"),
    )


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="teams_organization_id_slug_key"),
        Index("teams_organization_id_idx", "organization_id"),
    )


class TeamMembership(Base):
    __tablename__ = "team_memberships"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    team_id: Mapped[str] = mapped_column(Text, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[E.Role] = mapped_column(_pg_enum(E.Role, "Role"), nullable=False, server_default=text("'MEMBER'"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="team_memberships_team_id_user_id_key"),
        Index("team_memberships_user_id_idx", "user_id"),
    )


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    team_id: Mapped[str | None] = mapped_column(Text, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[E.CollectionVisibility] = mapped_column(
        _pg_enum(E.CollectionVisibility, "CollectionVisibility"), nullable=False, server_default=text("'ORGANIZATION'")
    )
    created_by_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="collections_organization_id_slug_key"),
        Index("collections_organization_id_idx", "organization_id"),
    )


class CollectionDocument(Base):
    __tablename__ = "collection_documents"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    collection_id: Mapped[str] = mapped_column(Text, ForeignKey("collections.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(Text, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("collection_id", "document_id", name="collection_documents_collection_id_document_id_key"),
        Index("collection_documents_document_id_idx", "document_id"),
    )


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    user_prompt_tpl: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_by_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("organization_id", "slug", "version", name="prompt_templates_organization_id_slug_version_key"),
        Index("prompt_templates_organization_id_slug_is_active_idx", "organization_id", "slug", "is_active"),
    )


class SsoConnection(Base):
    __tablename__ = "sso_connections"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[E.SsoProvider] = mapped_column(_pg_enum(E.SsoProvider, "SsoProvider"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    allowed_domains: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::TEXT[]"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("sso_connections_organization_id_enabled_idx", "organization_id", "enabled"),)


class ScimToken(Base):
    __tablename__ = "scim_tokens"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    prefix: Mapped[str] = mapped_column(Text, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (Index("scim_tokens_organization_id_idx", "organization_id"),)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, unique=True)
    plan: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'starter'"))
    status: Mapped[E.SubscriptionStatus] = mapped_column(
        _pg_enum(E.SubscriptionStatus, "SubscriptionStatus"), nullable=False, server_default=text("'TRIALING'")
    )
    external_customer_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_subscription_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    max_documents: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1000"))
    max_members: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("25"))
    max_api_keys: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("10"))
    monthly_budget_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())


class BudgetPeriod(Base):
    __tablename__ = "budget_periods"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    period: Mapped[str] = mapped_column(Text, nullable=False)
    spent_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    budget_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    hard_stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("organization_id", "period", name="budget_periods_organization_id_period_key"),)


class ToolInvocation(Base):
    __tablename__ = "tool_invocations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    organization_id: Mapped[str] = mapped_column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    tool_name: Mapped[str] = mapped_column(Text, nullable=False)
    side_effect: Mapped[E.ToolSideEffect] = mapped_column(_pg_enum(E.ToolSideEffect, "ToolSideEffect"), nullable=False)
    status: Mapped[E.ToolInvocationStatus] = mapped_column(
        _pg_enum(E.ToolInvocationStatus, "ToolInvocationStatus"), nullable=False, server_default=text("'SUCCEEDED'")
    )
    arguments: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    result_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("tool_invocations_organization_id_created_at_idx", "organization_id", "created_at"),
        Index("tool_invocations_organization_id_tool_name_created_at_idx", "organization_id", "tool_name", "created_at"),
    )

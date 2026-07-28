"""Schema inventory checks — SQLAlchemy tables match Prisma baseline."""

from __future__ import annotations

import akp_db.models  # noqa: F401
from akp_db.base import Base

EXPECTED_TABLES = {
    "organizations",
    "users",
    "memberships",
    "sessions",
    "api_keys",
    "invites",
    "data_sources",
    "documents",
    "document_chunks",
    "conversations",
    "messages",
    "citations",
    "ingestion_jobs",
    "evaluations",
    "evaluation_results",
    "usage_events",
    "audit_logs",
    "webhook_endpoints",
    "webhook_deliveries",
    "message_feedback",
    "idempotency_keys",
    "document_versions",
    "document_acls",
    "teams",
    "team_memberships",
    "collections",
    "collection_documents",
    "prompt_templates",
    "stored_objects",
    "sso_connections",
    "scim_tokens",
    "subscriptions",
    "budget_periods",
    "tool_invocations",
}


def test_model_table_inventory() -> None:
    tables = set(Base.metadata.tables.keys())
    assert tables == EXPECTED_TABLES


def test_document_chunk_has_vector_column() -> None:
    chunks = Base.metadata.tables["document_chunks"]
    assert "embedding" in chunks.c
    # pgvector Vector(1536)
    assert getattr(chunks.c.embedding.type, "dim", None) == 1536


def test_user_has_google_sub_and_mfa() -> None:
    users = Base.metadata.tables["users"]
    for col in ("google_sub", "mfa_enabled", "mfa_secret", "mfa_recovery_codes", "mfa_verified_at"):
        assert col in users.c

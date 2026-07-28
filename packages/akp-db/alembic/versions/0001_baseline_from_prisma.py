"""Baseline schema equivalent to Prisma migration history.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-28

Applies the concatenated Prisma SQL (init + governance + enterprise + google_identity)
so a fresh database matches the existing Postgres schema column-for-column, including
pgvector HNSW and trigram GIN indexes.

On databases already migrated by Prisma: run ``alembic stamp 0001_baseline`` instead
of ``upgrade``.
"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

_SQL_PATH = Path(__file__).with_name("_baseline_prisma.sql")


def upgrade() -> None:
    sql = _SQL_PATH.read_text(encoding="utf-8")
    # Split on statements carefully enough for Prisma's SQL dialect.
    # Execute as a single script via connection execution_options.
    connection = op.get_bind()
    connection.exec_driver_sql(sql)


def downgrade() -> None:
    raise NotImplementedError(
        "Baseline downgrade is not supported; drop the database and recreate instead."
    )

"""knowledge base tables + FTS5 virtual index

Revision ID: 0026
Revises: 0025
Create Date: 2026-04-25

See `docs/specs/kb/2026-04-25-knowledge-base-design.md`.

Tables: knowledge_bases / kb_collections / kb_documents / kb_document_versions /
kb_chunks / kb_grants / kb_embedding_jobs / kb_embedding_cache.

Plus a SQLite FTS5 virtual table `kb_chunks_fts` mirroring `kb_chunks.text`,
kept in sync via triggers (insert / update / delete). FTS5 ships in SQLite
since 3.9, no extension load required.

Vector storage v0: vectors live in `kb_chunks.embedding BLOB` (float32 LE).
Future migration can swap to per-KB `vec0` virtual tables without changing
chunk PKs — see design §5b.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_bases",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("workspace_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.String(1024), nullable=False, server_default=""),
        sa.Column("visibility", sa.String(16), nullable=False, server_default="private"),
        sa.Column("embedding_model_ref", sa.String(128), nullable=False),
        sa.Column("embedding_dim", sa.Integer, nullable=False),
        sa.Column("retrieval_config", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("document_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("chunk_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deleted_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("workspace_id", "name", name="uq_kb_workspace_name"),
    )
    op.create_index("idx_kb_workspace", "knowledge_bases", ["workspace_id", "deleted_at"])

    op.create_table(
        "kb_collections",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "kb_id",
            sa.String(64),
            sa.ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.String(64),
            sa.ForeignKey("kb_collections.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("path", sa.String(512), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("idx_kb_collections_kb", "kb_collections", ["kb_id"])
    op.create_index("idx_kb_collections_parent", "kb_collections", ["parent_id"])
    op.create_index("idx_kb_collections_path", "kb_collections", ["path"])

    op.create_table(
        "kb_documents",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "kb_id",
            sa.String(64),
            sa.ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "collection_id",
            sa.String(64),
            sa.ForeignKey("kb_collections.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("source_type", sa.String(16), nullable=False),
        sa.Column("source_uri", sa.String(2048), nullable=True),
        sa.Column("mime_type", sa.String(128), nullable=False),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("state_error", sa.Text, nullable=True),
        sa.Column("tags", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("metadata", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("chunk_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("failed_chunk_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("deleted_at", sa.DateTime, nullable=True),
        sa.Column("created_by_employee_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_index("idx_kb_documents_kb", "kb_documents", ["kb_id", "deleted_at"])
    op.create_index("idx_kb_documents_collection", "kb_documents", ["collection_id"])
    op.create_index("idx_kb_documents_state", "kb_documents", ["state"])
    op.create_index("idx_kb_documents_sha", "kb_documents", ["kb_id", "sha256"])

    op.create_table(
        "kb_document_versions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(64),
            sa.ForeignKey("kb_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("diff_summary", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("document_id", "version", name="uq_kb_docver_doc_ver"),
    )
    op.create_index("idx_kb_docvers_doc", "kb_document_versions", ["document_id"])

    op.create_table(
        "kb_chunks",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "document_id",
            sa.String(64),
            sa.ForeignKey("kb_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kb_id", sa.String(64), nullable=False),
        sa.Column("ordinal", sa.Integer, nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("token_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("section_path", sa.String(512), nullable=True),
        sa.Column("span_start", sa.Integer, nullable=False, server_default="0"),
        sa.Column("span_end", sa.Integer, nullable=False, server_default="0"),
        sa.Column("page", sa.Integer, nullable=True),
        sa.Column("metadata", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("embedding", sa.LargeBinary, nullable=True),
    )
    op.create_index("idx_kb_chunks_doc_ord", "kb_chunks", ["document_id", "ordinal"])
    op.create_index("idx_kb_chunks_kb_has_emb", "kb_chunks", ["kb_id"])

    op.create_table(
        "kb_grants",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "kb_id",
            sa.String(64),
            sa.ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("employee_id", sa.String(64), nullable=True),
        sa.Column("skill_id", sa.String(128), nullable=True),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("created_by", sa.String(64), nullable=True),
    )
    op.create_index("idx_kb_grants_kb", "kb_grants", ["kb_id"])
    op.create_index("idx_kb_grants_employee", "kb_grants", ["employee_id"])
    op.create_index("idx_kb_grants_skill", "kb_grants", ["skill_id"])

    op.create_table(
        "kb_embedding_jobs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("kb_id", sa.String(64), nullable=False),
        sa.Column("document_id", sa.String(64), nullable=False),
        sa.Column("chunk_id", sa.Integer, nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("enqueued_at", sa.DateTime, nullable=False),
        sa.Column("finished_at", sa.DateTime, nullable=True),
    )
    op.create_index("idx_kb_emb_jobs_state", "kb_embedding_jobs", ["state", "enqueued_at"])
    op.create_index("idx_kb_emb_jobs_doc", "kb_embedding_jobs", ["document_id"])
    op.create_index("idx_kb_emb_jobs_chunk", "kb_embedding_jobs", ["chunk_id"])

    op.create_table(
        "kb_embedding_cache",
        sa.Column("hash", sa.String(64), primary_key=True),
        sa.Column("model_ref", sa.String(128), nullable=False),
        sa.Column("dim", sa.Integer, nullable=False),
        sa.Column("vector", sa.LargeBinary, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("idx_kb_emb_cache_model", "kb_embedding_cache", ["model_ref"])

    # ── FTS5 virtual table mirroring kb_chunks.text + kb_id (for filtering)
    # Use the contentless option, populated via triggers, so we can carry a
    # kb_id column alongside the FTS-tokenized text. Indexed columns are text
    # and kb_id; rowid maps 1:1 to kb_chunks.id.
    op.execute(
        "CREATE VIRTUAL TABLE kb_chunks_fts USING fts5("
        "text, kb_id UNINDEXED, "
        "content='kb_chunks', content_rowid='id', "
        "tokenize='unicode61 remove_diacritics 2')"
    )
    op.execute(
        "CREATE TRIGGER kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN "
        "INSERT INTO kb_chunks_fts(rowid, text, kb_id) "
        "VALUES (new.id, new.text, new.kb_id); END;"
    )
    op.execute(
        "CREATE TRIGGER kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN "
        "INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, text, kb_id) "
        "VALUES('delete', old.id, old.text, old.kb_id); END;"
    )
    op.execute(
        "CREATE TRIGGER kb_chunks_au AFTER UPDATE OF text ON kb_chunks BEGIN "
        "INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, text, kb_id) "
        "VALUES('delete', old.id, old.text, old.kb_id); "
        "INSERT INTO kb_chunks_fts(rowid, text, kb_id) "
        "VALUES (new.id, new.text, new.kb_id); END;"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS kb_chunks_au")
    op.execute("DROP TRIGGER IF EXISTS kb_chunks_ad")
    op.execute("DROP TRIGGER IF EXISTS kb_chunks_ai")
    op.execute("DROP TABLE IF EXISTS kb_chunks_fts")

    for ix, tbl in [
        ("idx_kb_emb_cache_model", "kb_embedding_cache"),
        ("idx_kb_emb_jobs_chunk", "kb_embedding_jobs"),
        ("idx_kb_emb_jobs_doc", "kb_embedding_jobs"),
        ("idx_kb_emb_jobs_state", "kb_embedding_jobs"),
        ("idx_kb_grants_skill", "kb_grants"),
        ("idx_kb_grants_employee", "kb_grants"),
        ("idx_kb_grants_kb", "kb_grants"),
        ("idx_kb_chunks_kb_has_emb", "kb_chunks"),
        ("idx_kb_chunks_doc_ord", "kb_chunks"),
        ("idx_kb_docvers_doc", "kb_document_versions"),
        ("idx_kb_documents_sha", "kb_documents"),
        ("idx_kb_documents_state", "kb_documents"),
        ("idx_kb_documents_collection", "kb_documents"),
        ("idx_kb_documents_kb", "kb_documents"),
        ("idx_kb_collections_path", "kb_collections"),
        ("idx_kb_collections_parent", "kb_collections"),
        ("idx_kb_collections_kb", "kb_collections"),
        ("idx_kb_workspace", "knowledge_bases"),
    ]:
        op.drop_index(ix, table_name=tbl)

    op.drop_table("kb_embedding_cache")
    op.drop_table("kb_embedding_jobs")
    op.drop_table("kb_grants")
    op.drop_table("kb_chunks")
    op.drop_table("kb_document_versions")
    op.drop_table("kb_documents")
    op.drop_table("kb_collections")
    op.drop_table("knowledge_bases")

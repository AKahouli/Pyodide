"""Read-only logical-index adapter (Phase 4, P4.1-P4.6).

Bounded, parameterized reads against the protected ``logicalsearch`` index
through the read-only role. This module never writes, never installs an
extension or index, and never guesses a document identity: it detects what the
deployed index actually provides (P4.1), resolves candidates and returns
ambiguity explicitly (P4.2-P4.3), and reports independent readiness components
(P4.5). Index observations are persisted separately in the runtime database.

A ``connection`` here is any object exposing asyncpg-style ``fetch`` /
``fetchval``; tests pass a fake. The worker supplies a real pooled connection
created by :func:`create_index_pool`.
"""

from __future__ import annotations

import os
from typing import Any

MANIFEST_VERSION = "r1-index-v1"
MAX_CANDIDATES = 25

# Beneath the read-only role's 30-second ceiling (P4.4). Every adapter query
# must finish well inside this so one slow read cannot hold a shared slot.
INDEX_STATEMENT_TIMEOUT = "2s"

INDEX_TABLES = (
    "logical_documents",
    "logical_sections",
    "logical_blocks",
    "logical_images",
    "logical_text_positions",
)
INDEX_EXTENSIONS = ("vector", "pg_search")


class ReadOnlyIndexError(ValueError):
    """Deterministic adapter failure that must not consume retry budget."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _require_identity(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ReadOnlyIndexError(f"invalid_{name}")
    return value


def index_pool_server_settings() -> dict[str, str]:
    """Per-session guards; the role carries the same guards at login (P4.4)."""
    return {
        "application_name": "semantic-model-index-reader",
        "default_transaction_read_only": "on",
        "statement_timeout": INDEX_STATEMENT_TIMEOUT,
        "lock_timeout": "2s",
        "idle_in_transaction_session_timeout": "5s",
    }


async def create_index_pool(*, min_size: int = 1, max_size: int = 2):  # type: ignore[no-untyped-def]
    """Create the bounded read-only pool.

    ``max_size`` defaults to 2 per process; the four-connection ceiling reported
    by Phase 0 is a shared total across every reader replica (P4.SB02), so
    raising this requires platform recertification, not a code change alone.
    """
    import asyncpg

    dsn = os.environ.get("SEMANTIC_INDEX_DATABASE_URL", "")
    if not dsn:
        raise RuntimeError("index_database_url_missing")
    return await asyncpg.create_pool(
        dsn, min_size=min_size, max_size=max_size, command_timeout=5,
        server_settings=index_pool_server_settings(),
    )


async def detect_capabilities(connection: Any) -> dict[str, Any]:
    """Versioned capability manifest of the deployed index (P4.1).

    Detects extensions, tables and the columns readiness depends on. Nothing is
    installed and no missing facility is fabricated; a caller branches on the
    reported capabilities instead of assuming a schema.
    """
    server_version = await connection.fetchval("SHOW server_version")
    extension_rows = await connection.fetch(
        "SELECT extname, extversion FROM pg_extension WHERE extname = ANY($1::text[])",
        list(INDEX_EXTENSIONS),
    )
    table_rows = await connection.fetch(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
        list(INDEX_TABLES),
    )
    column_rows = await connection.fetch(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
        list(INDEX_TABLES),
    )
    extensions = {str(row["extname"]): str(row["extversion"]) for row in extension_rows}
    tables = {str(row["table_name"]) for row in table_rows}
    columns = {(str(row["table_name"]), str(row["column_name"])) for row in column_rows}

    def has(table: str, *names: str) -> bool:
        return table in tables and all((table, name) in columns for name in names)

    # The implemented lexical query reads both columns, so usable-now requires
    # both; a deployment with only one keeps lexical disabled rather than
    # running a query that references a missing column.
    has_tsvector = has("logical_blocks", "content_tsv") and has("logical_sections", "title_tsv")
    capabilities = {
        "structure": has("logical_documents", "id")
        and has("logical_sections", "id") and has("logical_blocks", "id"),
        "hierarchy": has("logical_sections", "parent_section_id", "ancestors", "descendants"),
        # `lexical` is usable-now: the adapter can only query a GIN tsvector it
        # knows the column for. BM25 presence is reported separately so the
        # manifest never claims a query path the adapter does not implement.
        "lexical": has_tsvector,
        "lexicalBm25Detected": "pg_search" in extensions,
        "vectors": "vector" in extensions
        and (has("logical_sections", "embedding") or has("logical_blocks", "embedding")),
        "visuals": has("logical_images") and has("logical_text_positions"),
        "wordCoordinates": has("logical_text_positions", "words"),
    }
    return {
        "manifestVersion": MANIFEST_VERSION,
        "serverVersion": str(server_version) if server_version else None,
        "extensions": dict(sorted(extensions.items())),
        "tables": sorted(tables),
        "capabilities": capabilities,
    }


async def resolve_document_candidates(connection: Any, *, workspace_id: Any, file_name: Any,
                                      uploader_user_id: Any = None,
                                      limit: int = MAX_CANDIDATES) -> dict[str, Any]:
    """Resolve candidate logical documents by verified Workspace metadata (P4.2).

    No asset ID, version or content hash exists in the logical tables, so
    identity is resolved through ``(workspace_id, file_name)`` with an optional
    uploader correlation. The result is explicit: one candidate is ``resolved``,
    several are ``ambiguous`` (never auto-picked), none is ``unresolved``.
    ``uploaderUserId`` is a correlation hint only, not an access grant (P4.3).
    """
    _require_identity(workspace_id, "workspace_id")
    _require_identity(file_name, "file_name")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_CANDIDATES:
        raise ReadOnlyIndexError("invalid_candidate_limit")
    sql = ("SELECT id, workspace_id, file_name, user_id FROM logical_documents "
           "WHERE workspace_id = $1 AND file_name = $2")
    params: list[Any] = [workspace_id, file_name]
    if uploader_user_id is not None:
        _require_identity(uploader_user_id, "uploader_user_id")
        params.append(uploader_user_id)
        sql += " AND user_id = $3"
    sql += f" ORDER BY id LIMIT {limit}"
    rows = await connection.fetch(sql, *params)
    candidates = [
        {"documentPk": row["id"], "workspaceId": row["workspace_id"],
         "fileName": row["file_name"], "uploaderUserId": row["user_id"]}
        for row in rows
    ]
    if len(candidates) == 1:
        resolution = "resolved"
    elif candidates:
        resolution = "ambiguous"
    else:
        resolution = "unresolved"
    return {"resolution": resolution, "candidates": candidates}


def build_index_observation(*, asset_ref: dict[str, Any], document_pk: Any,
                            capabilities: dict[str, Any],
                            fingerprint: Any = None) -> dict[str, Any]:
    """Pure observation shape for persistence (P4.6).

    Records what was observed, never a claim that the index matches the source
    version. Verification comes from the verified ``assetRef``; readiness is
    reported per component so a missing vector does not hide ready structure.
    """
    for key in ("workspaceId", "assetId", "assetVersionId"):
        _require_identity(asset_ref.get(key), key)
    verification = asset_ref.get("sourceVersionVerification")
    if verification not in ("verified", "partial", "unknown"):
        raise ReadOnlyIndexError("invalid_source_version_verification")
    # documentPk feeds the COALESCE(document_pk, -1) conflict bucket; only a
    # positive database id or an explicit unresolved None may enter it.
    if document_pk is not None and (
            isinstance(document_pk, bool) or not isinstance(document_pk, int) or document_pk <= 0):
        raise ReadOnlyIndexError("invalid_document_pk")
    return {
        "workspaceId": asset_ref["workspaceId"],
        "assetId": asset_ref["assetId"],
        "assetVersionId": asset_ref["assetVersionId"],
        "documentPk": document_pk,
        "verification": verification,
        "fingerprint": fingerprint,
        "readiness": {name: bool(capabilities.get(name)) for name in
                      ("structure", "hierarchy", "lexical", "vectors", "visuals")},
    }

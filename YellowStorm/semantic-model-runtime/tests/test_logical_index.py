from __future__ import annotations

import pytest

from app.datasource.logical_index import (INDEX_TABLES, MANIFEST_VERSION, ReadOnlyIndexError,
                                          build_index_observation, detect_capabilities,
                                          resolve_document_candidates)
from app.persistence.index_observations import record_index_observation


class FakeConnection:
    def __init__(self, *, scalar=None, extensions=None, tables=None, columns=None,
                 documents=None) -> None:
        self.scalar = scalar
        self.extensions = extensions or []
        self.tables = tables or []
        self.columns = columns or []
        self.documents = documents or []
        self.calls: list[tuple[str, tuple]] = []

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return self.scalar

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        if "pg_extension" in sql:
            return self.extensions
        if "information_schema.tables" in sql:
            return self.tables
        if "information_schema.columns" in sql:
            return self.columns
        if "logical_documents" in sql:
            return self.documents
        raise AssertionError(f"unexpected sql: {sql}")


def _columns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"table_name": table, "column_name": column} for table, column in pairs]


@pytest.mark.asyncio
async def test_capability_manifest_reports_every_component():
    conn = FakeConnection(
        scalar="17.6",
        extensions=[{"extname": "vector", "extversion": "0.8.0"},
                    {"extname": "pg_search", "extversion": "0.18.9"}],
        tables=[{"table_name": name} for name in INDEX_TABLES],
        columns=_columns(
            ("logical_documents", "id"), ("logical_blocks", "id"),
            ("logical_blocks", "content_tsv"), ("logical_blocks", "embedding"),
            ("logical_sections", "id"), ("logical_sections", "parent_section_id"),
            ("logical_sections", "ancestors"), ("logical_sections", "descendants"),
            ("logical_sections", "title_tsv"), ("logical_text_positions", "words"),
        ),
    )
    manifest = await detect_capabilities(conn)
    assert manifest["manifestVersion"] == MANIFEST_VERSION
    assert manifest["serverVersion"] == "17.6"
    assert manifest["extensions"] == {"pg_search": "0.18.9", "vector": "0.8.0"}
    assert manifest["capabilities"] == {
        "structure": True, "hierarchy": True, "lexical": True, "lexicalBm25Detected": True,
        "vectors": True, "visuals": True, "wordCoordinates": True,
    }


@pytest.mark.asyncio
async def test_capability_manifest_does_not_fabricate_missing_facilities():
    conn = FakeConnection(
        scalar="15.3", extensions=[],
        tables=[{"table_name": name} for name in
                ("logical_documents", "logical_sections", "logical_blocks")],
        columns=_columns(("logical_documents", "id"), ("logical_sections", "id"),
                         ("logical_blocks", "id")),
    )
    capabilities = (await detect_capabilities(conn))["capabilities"]
    assert capabilities["structure"] is True
    assert capabilities["hierarchy"] is False
    assert capabilities["lexical"] is False
    assert capabilities["vectors"] is False
    assert capabilities["visuals"] is False


@pytest.mark.asyncio
async def test_resolution_is_explicit_and_bounded():
    resolved = FakeConnection(documents=[{"id": 7, "workspace_id": "ws", "file_name": "a.pdf",
                                          "user_id": "u1"}])
    result = await resolve_document_candidates(resolved, workspace_id="ws", file_name="a.pdf")
    assert result["resolution"] == "resolved"
    assert result["candidates"] == [{"documentPk": 7, "workspaceId": "ws", "fileName": "a.pdf",
                                     "uploaderUserId": "u1"}]
    sql, params = resolved.calls[0]
    assert params == ("ws", "a.pdf")
    assert sql.endswith("ORDER BY id LIMIT 25")

    ambiguous = FakeConnection(documents=[{"id": 1, "workspace_id": "ws", "file_name": "a.pdf",
                                           "user_id": "u1"},
                                          {"id": 2, "workspace_id": "ws", "file_name": "a.pdf",
                                           "user_id": "u2"}])
    assert (await resolve_document_candidates(ambiguous, workspace_id="ws",
                                              file_name="a.pdf"))["resolution"] == "ambiguous"

    empty = FakeConnection(documents=[])
    assert (await resolve_document_candidates(empty, workspace_id="ws",
                                              file_name="a.pdf"))["resolution"] == "unresolved"

    scoped = FakeConnection(documents=[])
    await resolve_document_candidates(scoped, workspace_id="ws", file_name="a.pdf",
                                      uploader_user_id="u1")
    assert scoped.calls[0][1] == ("ws", "a.pdf", "u1")


@pytest.mark.asyncio
async def test_resolution_rejects_invalid_inputs():
    conn = FakeConnection()
    with pytest.raises(ReadOnlyIndexError):
        await resolve_document_candidates(conn, workspace_id="", file_name="a.pdf")
    with pytest.raises(ReadOnlyIndexError):
        await resolve_document_candidates(conn, workspace_id="ws", file_name="  ")
    with pytest.raises(ReadOnlyIndexError):
        await resolve_document_candidates(conn, workspace_id="ws", file_name="a.pdf", limit=0)
    with pytest.raises(ReadOnlyIndexError):
        await resolve_document_candidates(conn, workspace_id="ws", file_name="a.pdf", limit=True)
    assert conn.calls == []


def test_index_observation_reports_readiness_and_rejects_bad_verification():
    observation = build_index_observation(
        asset_ref={"workspaceId": "ws", "assetId": "a", "assetVersionId": "sha256:abc",
                   "sourceVersionVerification": "verified"},
        document_pk=3,
        capabilities={"structure": True, "hierarchy": True, "lexical": False,
                      "vectors": False, "visuals": True},
    )
    assert observation["readiness"] == {"structure": True, "hierarchy": True, "lexical": False,
                                        "vectors": False, "visuals": True}
    assert observation["documentPk"] == 3
    assert observation["verification"] == "verified"

    with pytest.raises(ReadOnlyIndexError):
        build_index_observation(
            asset_ref={"workspaceId": "ws", "assetId": "a", "assetVersionId": "obs:a:1",
                       "sourceVersionVerification": "guessed"},
            document_pk=None, capabilities={})

    good_ref = {"workspaceId": "ws", "assetId": "a", "assetVersionId": "obs:a:1",
                "sourceVersionVerification": "partial"}
    for bad_pk in (-1, 0, "3", True):
        with pytest.raises(ReadOnlyIndexError):
            build_index_observation(asset_ref=good_ref, document_pk=bad_pk, capabilities={})


@pytest.mark.asyncio
async def test_record_index_observation_is_idempotent_upsert():
    class FakePool:
        def __init__(self) -> None:
            self.call: tuple | None = None

        async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
            self.call = (sql, params)
            return {"id": "obs-1"}

    pool = FakePool()
    observation = {"workspaceId": "ws", "assetId": "a", "assetVersionId": "sha256:abc",
                   "documentPk": None, "verification": "partial", "fingerprint": None,
                   "readiness": {"vectors": False, "structure": True}}
    assert await record_index_observation(pool, observation) == "obs-1"
    assert pool.call is not None
    sql, params = pool.call
    assert "ON CONFLICT (asset_version_id, COALESCE(document_pk, -1))" in sql
    assert params[3] is None
    assert params[6] == '{"structure": true, "vectors": false}'

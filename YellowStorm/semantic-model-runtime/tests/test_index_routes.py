from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")
TestClient = pytest.importorskip("starlette.testclient", reason="starlette TestClient required").TestClient

from app.main import create_app  # noqa: E402

AUTH = {"X-Semantic-Service-Key": "test-key"}
SCOPE = {"actorUserId": "u1", "workspaceId": "ws1", "fileName": "a.pdf"}
DOCS = [{"id": 42, "workspace_id": "ws1", "file_name": "a.pdf", "user_id": "u1"}]
SECTIONS = [{"id": 1, "section_id": "sec_1", "title": "Root", "level": 0,
             "parent_section_id": None}]
BLOCKS = [{"id": 10, "section_id": "sec_1", "block_id": "p1_b1", "block_type": "text",
           "content": "hello world", "page_number": 1}]
SEARCH_ROWS = [{"section_pk": 1, "section_key": "sec_1", "section_title": "Root",
                "block_pk": 10, "block_key": "p1_b1", "block_type": "text",
                "page_number": 1, "rank": 0.7}]
EVIDENCE = [{"block_pk": 10, "block_key": "p1_b1", "section_key": "sec_1", "section_pk": 1,
             "block_type": "text", "content": "hello world", "page_number": 1}]
COLUMNS = [{"table_name": table, "column_name": column} for table, column in [
    ("logical_documents", "id"), ("logical_sections", "id"),
    ("logical_sections", "parent_section_id"), ("logical_sections", "ancestors"),
    ("logical_sections", "descendants"), ("logical_sections", "title_tsv"),
    ("logical_blocks", "id"), ("logical_blocks", "content_tsv"),
]]


class FakeConnection:
    def __init__(self, *, documents=None) -> None:
        self.documents = DOCS if documents is None else documents

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        assert "server_version" in sql
        return "17.6"

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        if "pg_extension" in sql:
            return []
        if "information_schema.tables" in sql:
            return [{"table_name": "logical_documents"}, {"table_name": "logical_sections"},
                    {"table_name": "logical_blocks"}]
        if "information_schema.columns" in sql:
            return COLUMNS
        if "FROM logical_blocks b" in sql:
            return EVIDENCE
        if "plainto_tsquery" in sql or "s.title = $2" in sql:
            return SEARCH_ROWS
        if "FROM logical_blocks" in sql:
            return BLOCKS
        if "FROM logical_documents" in sql:
            return self.documents
        if "FROM logical_sections" in sql:
            return SECTIONS
        raise AssertionError(sql)


class FakePool:
    def __init__(self, connection: FakeConnection) -> None:
        self.connection = connection
        self.closed = False

    def acquire(self):  # type: ignore[no-untyped-def]
        return self

    async def __aenter__(self) -> FakeConnection:
        return self.connection

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_ENABLED", "true")
    monkeypatch.delenv("SEMANTIC_INDEX_DATABASE_URL", raising=False)
    app = create_app()
    pool = FakePool(FakeConnection())
    app.state.index_pool = pool
    app.state.index_pool_owned = False
    with TestClient(app) as test_client:
        yield test_client
    assert pool.closed is False


def test_outline_resolves_scope_then_reads(client: TestClient):
    response = client.post("/v1/semantic-model-datasource/documents/outline",
                           headers=AUTH, json=SCOPE)
    assert response.status_code == 200
    body = response.json()
    assert body["resolution"] == "resolved"
    assert body["sections"][0]["sectionKey"] == "sec_1"


def test_ambiguous_scope_returns_candidates_not_content(client: TestClient):
    app_client = client
    pool = FakePool(FakeConnection(documents=[
        {"id": 1, "workspace_id": "ws1", "file_name": "a.pdf", "user_id": "u1"},
        {"id": 2, "workspace_id": "ws1", "file_name": "a.pdf", "user_id": "u2"}]))
    app_client.app.state.index_pool = pool
    response = app_client.post("/v1/semantic-model-datasource/documents/outline",
                               headers=AUTH, json=SCOPE)
    assert response.status_code == 200
    assert response.json()["resolution"] == "ambiguous"
    assert len(response.json()["candidates"]) == 2
    assert "sections" not in response.json()


def test_search_sections_and_evidence_reads(client: TestClient):
    search = client.post("/v1/semantic-model-datasource/documents/search",
                         headers=AUTH, json={**SCOPE, "method": "exact", "value": "hello"})
    assert search.status_code == 200
    assert search.json()["hits"][0]["sectionPk"] == 1

    lexical = client.post("/v1/semantic-model-datasource/documents/search",
                          headers=AUTH, json={**SCOPE, "method": "lexical", "value": "hello"})
    assert lexical.status_code == 200
    assert lexical.json()["method"] == "lexical"

    sections = client.post("/v1/semantic-model-datasource/documents/sections/read",
                           headers=AUTH, json={**SCOPE, "sectionPks": [1]})
    assert sections.status_code == 200
    assert sections.json()["sections"][0]["blocks"][0]["blockKey"] == "p1_b1"

    evidence = client.post("/v1/semantic-model-datasource/evidence/read",
                           headers=AUTH, json={**SCOPE, "blockPks": [10]})
    assert evidence.status_code == 200
    assert evidence.json()["packets"][0]["rawText"] == "hello world"


def test_index_routes_require_service_key_and_valid_body(client: TestClient):
    assert client.post("/v1/semantic-model-datasource/documents/outline",
                       json=SCOPE).status_code == 401
    bad = client.post("/v1/semantic-model-datasource/documents/sections/read",
                      headers=AUTH, json={**SCOPE, "sectionPks": []})
    assert bad.status_code == 422


def test_index_routes_fail_closed_without_runtime(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    monkeypatch.delenv("SEMANTIC_MODEL_RUNTIME_ENABLED", raising=False)
    monkeypatch.delenv("SEMANTIC_INDEX_DATABASE_URL", raising=False)
    app = create_app()
    app.state.index_pool = None
    app.state.index_pool_owned = False
    with TestClient(app) as offline:
        response = offline.post("/v1/semantic-model-datasource/documents/outline",
                                headers=AUTH, json=SCOPE)
        assert response.status_code == 503
        assert response.json()["detail"] == "runtime_unavailable"


def test_index_routes_fail_closed_without_pool(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_ENABLED", "true")
    monkeypatch.delenv("SEMANTIC_INDEX_DATABASE_URL", raising=False)
    app = create_app()
    app.state.index_pool = None
    app.state.index_pool_owned = False
    with TestClient(app) as offline:
        response = offline.post("/v1/semantic-model-datasource/documents/outline",
                                headers=AUTH, json=SCOPE)
        assert response.status_code == 503
        assert response.json()["detail"] == "index_unavailable"

from types import SimpleNamespace

import pytest

from src.flow_engine.deep_search import (
    merge_file_names,
    normalize_response,
    search_relevant_documents,
)


def test_merge_file_names_is_case_insensitive_and_preserves_input_order():
    assert merge_file_names(
        ["Dragged.pdf", "second.pdf"],
        ["dragged.PDF", "Relevant.pdf", "second.pdf"],
    ) == ["Dragged.pdf", "second.pdf", "Relevant.pdf"]
    assert merge_file_names([], ["Relevant.pdf"]) == ["Relevant.pdf"]


def test_normalize_response_deduplicates_results():
    result = normalize_response(
        {
            "workspace_id": "workspace-1",
            "results": [
                {"file_name": "Contract.pdf", "description": "Contract", "hybrid_score": 0.91},
                {"file_name": "contract.PDF", "hybrid_score": 0.80},
                {"file_name": "Annex.pdf", "hybrid_score": "0.75"},
            ],
        },
        "fallback",
    )

    assert result["total_results"] == 2
    assert [item["file_name"] for item in result["results"]] == ["Contract.pdf", "Annex.pdf"]
    assert result["results"][1]["hybrid_score"] == 0.75


@pytest.mark.anyio
async def test_search_relevant_documents_calls_authenticated_rest_endpoint(monkeypatch):
    captured = {}

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "workspace_id": "workspace-1",
                "total_results": 1,
                "results": [{"file_name": "Contract.pdf", "hybrid_score": 0.91}],
            }

    class _Client:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            captured.update(url=url, headers=headers, json=json)
            return _Response()

    monkeypatch.setattr(
        "src.flow_engine.deep_search.get_settings",
        lambda: SimpleNamespace(
            COMMUNITY_GRAPH_URL="http://localhost:8045/",
            MCP_API_KEY_DEEP_SEARCH="secret-key",
            DEEP_SEARCH_TIMEOUT_SECONDS=12,
        ),
    )
    monkeypatch.setattr("src.flow_engine.deep_search.httpx.AsyncClient", _Client)

    result = await search_relevant_documents("penalties", "workspace-1")

    assert captured["url"] == "http://localhost:8045/relevant-documents/search"
    assert captured["headers"] == {
        "Authorization": "Bearer secret-key",
        "Workspace-Id": "workspace-1",
        "Content-Type": "application/json",
    }
    assert captured["json"] == {
        "query": "penalties",
        "workspace_id": "workspace-1",
    }
    assert captured["timeout"] == 12
    assert result["results"][0]["file_name"] == "Contract.pdf"


@pytest.mark.anyio
async def test_search_relevant_documents_requires_configuration(monkeypatch):
    monkeypatch.setattr(
        "src.flow_engine.deep_search.get_settings",
        lambda: SimpleNamespace(COMMUNITY_GRAPH_URL=None, MCP_API_KEY_DEEP_SEARCH=None),
    )

    with pytest.raises(RuntimeError, match="COMMUNITY_GRAPH_URL"):
        await search_relevant_documents("query", "workspace-1")

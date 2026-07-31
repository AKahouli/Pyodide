from types import SimpleNamespace

import pytest

from src.flow_engine.deep_search import (
    merge_file_names,
    normalize_response,
    routed_file_items,
    search_relevant_documents,
)


def test_merge_file_names_is_case_insensitive_and_preserves_input_order():
    assert merge_file_names(
        ["Dragged.pdf", "second.pdf"],
        ["dragged.PDF", "Relevant.pdf", "second.pdf"],
    ) == ["Dragged.pdf", "second.pdf", "Relevant.pdf"]
    assert merge_file_names([], ["Relevant.pdf"]) == ["Relevant.pdf"]


def test_normalize_response_preserves_routing_plan_and_deduplicates_files():
    result = normalize_response(
        {
            "workspace_id": "workspace-1",
            "status": "ROUTED",
            "files": [
                {
                    "document_id": "doc-1",
                    "file_name": "Contract.pdf",
                    "routing_decision": "ROUTE",
                    "search_for": ["annual reference amount"],
                    "reason": "Contract entity matches.",
                },
                {"file_name": "contract.PDF", "routing_decision": "ROUTE"},
                {
                    "file_name": "Annex.pdf",
                    "routing_decision": "ROUTE",
                    "search_for": ["SLA"],
                },
            ],
            "missing_requirements": [],
        },
    )

    assert result["status"] == "ROUTED"
    assert result["total_files"] == 2
    assert [item["file_name"] for item in result["files"]] == ["Contract.pdf", "Annex.pdf"]
    assert result["files"][0]["search_for"] == ["annual reference amount"]
    assert result["files"][0]["reason"] == "Contract entity matches."


def test_normalize_response_accepts_no_relevant_files():
    result = normalize_response(
        {
            "workspace_id": "workspace-1",
            "status": "NO_RELEVANT_FILES",
            "files": [],
            "missing_requirements": ["No matching contract"],
        },
    )

    assert result["status"] == "NO_RELEVANT_FILES"
    assert result["files"] == []
    assert result["total_files"] == 0


def test_normalize_response_accepts_wrapped_results():
    result = normalize_response(
        {
            "success": True,
            "data": {
                "workspace_id": "workspace-1",
                "results": [
                    {"file_name": "Contract.pdf", "hybrid_score": 0.91},
                ],
            },
        },
    )

    assert result["workspace_id"] == "workspace-1"
    assert result["files"] == [
        {"file_name": "Contract.pdf", "hybrid_score": 0.91},
    ]
    assert result["total_files"] == 1


def test_normalize_response_preserves_required_and_optional_files():
    result = normalize_response(
        {
            "workspace_id": "workspace-1",
            "status": "ROUTED",
            "files": {
                "required": [
                    {"file_name": "Required.pdf", "reason": "Exact period match"},
                ],
                "optional": [
                    {"file_name": "Optional.pdf", "reason": "Related content"},
                ],
            },
        },
    )

    assert result["files"] == {
        "required": [
            {"file_name": "Required.pdf", "reason": "Exact period match"},
        ],
        "optional": [
            {"file_name": "Optional.pdf", "reason": "Related content"},
        ],
    }
    assert result["total_files"] == 2
    assert [item["file_name"] for item in routed_file_items(result)] == [
        "Required.pdf",
        "Optional.pdf",
    ]


@pytest.mark.anyio
async def test_search_relevant_documents_calls_authenticated_rest_endpoint(monkeypatch):
    captured = {}

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "workspace_id": "workspace-1",
                "status": "ROUTED",
                "files": [
                    {
                        "file_name": "Contract.pdf",
                        "routing_decision": "ROUTE",
                        "search_for": ["penalties"],
                        "reason": "Contract matches.",
                    }
                ],
                "missing_requirements": [],
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
            API_KEY_COMMUNITY_GRAPH="secret-key",
            DEEP_SEARCH_TIMEOUT_SECONDS=12,
        ),
    )
    monkeypatch.setattr("src.flow_engine.deep_search.httpx.AsyncClient", _Client)

    result = await search_relevant_documents("penalties", "workspace-1")

    assert captured["url"] == "http://localhost:8045/api/query"
    assert captured["headers"] == {
        "Authorization": "Bearer secret-key",
        "Content-Type": "application/json",
    }
    assert captured["json"] == {
        "workspace_id": "workspace-1",
        "query": "penalties",
    }
    assert captured["timeout"] == 12
    assert result["files"][0]["file_name"] == "Contract.pdf"
    assert result["files"][0]["search_for"] == ["penalties"]


@pytest.mark.anyio
async def test_search_relevant_documents_requires_configuration(monkeypatch):
    monkeypatch.setattr(
        "src.flow_engine.deep_search.get_settings",
        lambda: SimpleNamespace(COMMUNITY_GRAPH_URL=None, API_KEY_COMMUNITY_GRAPH=None),
    )

    with pytest.raises(RuntimeError, match="COMMUNITY_GRAPH_URL"):
        await search_relevant_documents("query", "workspace-1")

    monkeypatch.setattr(
        "src.flow_engine.deep_search.get_settings",
        lambda: SimpleNamespace(
            COMMUNITY_GRAPH_URL="http://localhost:8045",
            API_KEY_COMMUNITY_GRAPH=None,
        ),
    )

    with pytest.raises(RuntimeError, match="API_KEY_COMMUNITY_GRAPH"):
        await search_relevant_documents("query", "workspace-1")


@pytest.mark.anyio
async def test_search_relevant_documents_requires_workspace_id(monkeypatch):
    monkeypatch.setattr(
        "src.flow_engine.deep_search.get_settings",
        lambda: SimpleNamespace(
            COMMUNITY_GRAPH_URL="http://localhost:8045",
            API_KEY_COMMUNITY_GRAPH="secret-key",
        ),
    )

    with pytest.raises(RuntimeError, match="workspace_id"):
        await search_relevant_documents("query", "")

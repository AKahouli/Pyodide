import json

import httpx
import pytest

from src.smart_rag.tools.utilities.semantic_search import create_semantic_search


@pytest.mark.asyncio
async def test_semantic_search_posts_bound_schema_and_supporting_data(monkeypatch):
    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = {"Authorization": request.headers["Authorization"]}
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"answer": "found"})

    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient
    client_options = {}

    def create_client(**kwargs):
        client_options.update(kwargs)
        return original_client(transport=transport, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", create_client)
    tool = create_semantic_search({
        "semantic_model_schema_name": "sem_123",
        "semantic_search_url": "http://127.0.0.1:8100/v1/graphs/search/fused",
        "semantic_search_token": "search-token",
        "semantic_search_timeout_seconds": "420",
    })

    assert tool is not None
    assert await tool(" user question ") == {"answer": "found"}
    assert client_options["timeout"] == 420.0
    assert captured == {
        "url": "http://127.0.0.1:8100/v1/graphs/search/fused",
        "headers": {"Authorization": "Bearer search-token"},
        "body": {
            "schema_name": "sem_123",
            "query": "user question",
            "debug": False,
            "include_supporting_data": True,
        },
    }


def test_semantic_search_requires_trusted_runtime_context():
    assert create_semantic_search({}) is None

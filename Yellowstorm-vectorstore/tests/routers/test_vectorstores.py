import pytest
from types import SimpleNamespace
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from src.routers import vectorstores
from src.schema.authentification import User
from src.dependencies.authentication import get_current_active_user

@pytest.mark.asyncio
async def test_delete_vectorstore_success(monkeypatch):
    app = FastAPI()
    app.include_router(vectorstores.router)

    app.dependency_overrides[get_current_active_user] = lambda: User(username="testuser")

    monkeypatch.setattr(vectorstores, "app_settings", SimpleNamespace(QDRANT_COLLECTION_NAME="test_vectorstore"))

    def fake_query_collection_by_filter(collection_name, filter, include=None, exclude=None):
        assert collection_name == "test_vectorstore"
        return [{"_id": "id1"}, {"_id": "id2"}]

    monkeypatch.setattr(vectorstores, "query_collection_by_filter", fake_query_collection_by_filter)

    delete_calls = []

    async def fake_async_delete_by_ids(collection_name, ids):
        delete_calls.append((collection_name, list(ids)))
        return True

    monkeypatch.setattr(vectorstores, "async_delete_by_ids", fake_async_delete_by_ids)

    payload = {"brain_id": "some_brain", "external_id": "some_external"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.request("DELETE", "/vectorstores/vectorIds/V2", json=payload)

    assert response.status_code == 200
    assert response.json() is True

    assert len(delete_calls) == 1
    coll, ids = delete_calls[0]
    assert coll == "test_vectorstore"
    assert set(ids) == {"id1", "id2"}

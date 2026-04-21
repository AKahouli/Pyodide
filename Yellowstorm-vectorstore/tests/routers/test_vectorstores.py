import pytest
from types import SimpleNamespace
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from src.routers import vectorstores
from src.schema.authentification import User
from src.schema.logical_indexing import LogicalIndexingRequest
from src.dependencies.authentication import get_current_active_user

@pytest.mark.asyncio
async def test_delete_vectorstore_success(monkeypatch):
    app = FastAPI()
    app.include_router(vectorstores.router)

    app.dependency_overrides[get_current_active_user] = lambda: User(username="testuser")

    monkeypatch.setattr(vectorstores, "app_settings", SimpleNamespace(QDRANT_COLLECTION_NAME="test_vectorstore"))

    # Mock get_qdrant_client to return a mock client
    mock_client = SimpleNamespace()
    mock_client.delete = lambda collection_name, points_selector, wait: None
    monkeypatch.setattr(vectorstores, "get_qdrant_client", lambda: mock_client)

    payload = {"brain_id": "some_brain", "external_id": "some_external"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.request("DELETE", "/vectorstores/vectorIds/V2", json=payload)

    assert response.status_code == 200
    assert response.json() is True


def test_logical_indexing_request_schema_has_no_webhook_fields():
    fields = getattr(LogicalIndexingRequest, "model_fields", None)
    if fields is None:
        fields = LogicalIndexingRequest.__fields__
    assert "webhook_url" not in fields
    assert "webhook_metadata" not in fields


@pytest.mark.asyncio
async def test_logical_index_document_ignores_webhook_fields(monkeypatch):
    app = FastAPI()
    app.include_router(vectorstores.router)
    app.dependency_overrides[get_current_active_user] = lambda: User(username="testuser")

    captured = {}

    def fake_send_task(name, kwargs=None, queue=None):
        captured["name"] = name
        captured["kwargs"] = kwargs
        captured["queue"] = queue
        return SimpleNamespace(id="logical-task-123")

    monkeypatch.setattr(vectorstores.celery_app, "send_task", fake_send_task)

    payload = {
        "file_path": "documents/sample.pdf",
        "external_id": "external-123",
        "brain_id": "brain-456",
        "webhook_url": "http://localhost:3000/api/v1/indexing/webhook",
        "webhook_metadata": {"task_id": "abc"},
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.post("/vectorstores/logicalIndexing", json=payload)

    assert response.status_code == 202
    assert response.json() == {
        "task_id": "logical-task-123",
        "status": "queued",
        "message": "Logical indexing task queued for external-123",
    }
    assert captured == {
        "name": "logical-indexing.parse-document",
        "kwargs": {
            "file_path": "documents/sample.pdf",
            "external_id": "external-123",
            "brain_id": "brain-456",
            "doc_id": None,
            "source": None,
        },
        "queue": "logical-indexing",
    }

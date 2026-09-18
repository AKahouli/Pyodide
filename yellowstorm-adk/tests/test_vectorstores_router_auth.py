"""Auth contract for the attachment-profile endpoint."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from src.config.settings import get_settings
from src.routers.vectorstores import router


def _client() -> TestClient:
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _with_api_key(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "ADK_API_KEY", "secret-key", raising=False)


def test_attachment_profile_requires_api_key(monkeypatch):
    _with_api_key(monkeypatch)
    response = _client().post(
        "/vectorstores/attachmentProfile",
        json={"document_id": "doc-1", "path": "user-1/conv-1/a.pdf", "filename": "a.pdf"},
    )
    assert response.status_code == 401


def test_attachment_profile_accepts_valid_api_key(monkeypatch):
    _with_api_key(monkeypatch)
    profile = {
        "version": 1,
        "document_id": "doc-1",
        "filename": "a.pdf",
        "mime_type": "application/pdf",
        "extraction": {"status": "ready", "extractor": "pymupdf", "characters": 4, "truncated": False},
        "content": "text",
        "generated_at": "2026-01-01T00:00:00+00:00",
    }
    with patch(
        "src.modules.attachment_profile.service.attachment_profile_service.build_profile",
        new=AsyncMock(return_value=profile),
    ):
        response = _client().post(
            "/vectorstores/attachmentProfile",
            json={"document_id": "doc-1", "path": "user-1/conv-1/a.pdf", "filename": "a.pdf"},
            headers={"x-api-key": "secret-key"},
        )
    assert response.status_code == 200
    assert response.json()["document_id"] == "doc-1"

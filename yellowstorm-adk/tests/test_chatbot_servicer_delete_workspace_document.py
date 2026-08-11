from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.grpc_server.chatbot_servicer import ChatbotServicer


@pytest.mark.asyncio
async def test_delete_workspace_document_calls_logical_indexing_endpoint():
    # Bypass unrelated database-backed conversation-session initialization.
    servicer = ChatbotServicer.__new__(ChatbotServicer)
    request = SimpleNamespace(
        file_name="annual report.pdf",
        workspace_name="Finance",
        workspace_id="workspace-123",
        correlation_id="correlation-456",
    )
    context = AsyncMock()

    response = MagicMock(status=204)
    response_context = MagicMock()
    response_context.__aenter__ = AsyncMock(return_value=response)
    response_context.__aexit__ = AsyncMock(return_value=False)

    session = MagicMock()
    session.delete.return_value = response_context
    session_context = MagicMock()
    session_context.__aenter__ = AsyncMock(return_value=session)
    session_context.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "src.grpc_server.chatbot_servicer.app_settings.VECTORSTORES_API_URL",
            "http://vectorstores:8005",
        ),
        patch(
            "src.grpc_server.chatbot_servicer.app_settings.VECTORSTORE_API_KEY",
            "secret-key",
        ),
        patch(
            "src.grpc_server.chatbot_servicer.aiohttp.ClientSession",
            return_value=session_context,
        ),
    ):
        result = await servicer.DeleteWorkspaceDocument(request, context)

    assert result.deleted is True
    session.delete.assert_called_once_with(
        "http://vectorstores:8005/vectorstores/logicalIndexing/annual%20report.pdf",
        params={
            "workspace_name": "Finance",
            "workspace_id": "workspace-123",
        },
        headers={
            "x-api-key": "secret-key",
            "correlation-id": "correlation-456",
        },
    )

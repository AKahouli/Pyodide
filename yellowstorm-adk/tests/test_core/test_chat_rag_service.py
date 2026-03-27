"""Tests for ChatRAGService."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio

from src.smart_rag.core.chat_rag_service import ChatRAGService


class TestChatRAGService:
    """Test cases for ChatRAGService."""

    def test_init(self):
        """Test service initialization."""
        with patch('src.smart_rag.core.chat_rag_service.SmartRAGOrchestrator') as mock_orchestrator:
            service = ChatRAGService()
            mock_orchestrator.assert_called_once()
            assert service.orchestrator is not None

    @pytest.mark.asyncio
    async def test_process_chat_request(self, mock_chat_request, mock_queue):
        """Test chat request processing."""
        with patch('src.smart_rag.core.chat_rag_service.SmartRAGOrchestrator') as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.chat_smart_rag = AsyncMock()
            mock_orchestrator_class.return_value = mock_orchestrator

            service = ChatRAGService()
            await service.process_chat_request(mock_chat_request, mock_queue)

            mock_orchestrator.chat_smart_rag.assert_called_once_with(mock_chat_request, mock_queue)

    @pytest.mark.asyncio
    async def test_process_chat_request_with_exception(self, mock_chat_request, mock_queue):
        """Test chat request processing when orchestrator raises an exception."""
        with patch('src.smart_rag.core.chat_rag_service.SmartRAGOrchestrator') as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.chat_smart_rag = AsyncMock(side_effect=Exception("Test error"))
            mock_orchestrator_class.return_value = mock_orchestrator

            service = ChatRAGService()

            with pytest.raises(Exception, match="Test error"):
                await service.process_chat_request(mock_chat_request, mock_queue)

    def test_service_attributes(self):
        """Test service has expected attributes."""
        with patch('src.smart_rag.core.chat_rag_service.SmartRAGOrchestrator'):
            service = ChatRAGService()
            assert hasattr(service, 'orchestrator')
            assert service.orchestrator is not None
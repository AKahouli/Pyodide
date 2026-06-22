"""Main service for traditional RAG chat functionality.

This module provides the high-level service interface for the /chatbots/chatWithADK endpoint.
It orchestrates the traditional RAG workflow using the SmartRAGOrchestrator from the traditional engine.
"""

import asyncio

from src.logger.logging import get_logger
from src.schema.chatbot_schema import ChatWithADKRequest
from src.smart_rag.engines.traditional.orchestrator import SmartRAGOrchestrator

logger = get_logger(__name__)


class ChatRAGService:
    """Main service for traditional RAG chat functionality.

    This service acts as the entry point for traditional RAG operations,
    coordinating between the API layer and the traditional RAG engine.

    Attributes:
        orchestrator: The traditional RAG orchestrator instance.
    """

    def __init__(self):
        self.orchestrator = SmartRAGOrchestrator()

    async def process_chat_request(self, request: ChatWithADKRequest, queue: asyncio.Queue[dict]) -> None:
        """Process a traditional RAG chat request.

        Entry point for /chatbots/chatWithADK endpoint. Delegates to the
        traditional RAG orchestrator for processing.

        Args:
            request: The chat request containing user prompt and configuration.
            queue: AsyncIO queue for streaming response events back to client.

        Returns:
            None: Results are streamed through the queue.
        """
        logger.info(f"[SERVICE] Processing chat request - user_id: {request.user_id}, session_id: {request.session_id}")

        try:
            await self.orchestrator.chat_smart_rag(request, queue)
            logger.info(f"[SERVICE] Chat request completed successfully - session_id: {request.session_id}")
        except Exception as e:
            logger.error(f"[SERVICE] Chat request failed - session_id: {request.session_id}: {str(e)}")
            raise

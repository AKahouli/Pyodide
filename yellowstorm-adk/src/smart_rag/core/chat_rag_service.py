"""Main service for traditional RAG chat functionality.

This module provides the high-level service interface for the /chatbots/chatWithADK endpoint.
It orchestrates the traditional RAG workflow using the SmartRAGOrchestrator from the traditional engine,
with conditional routing to external APIs for specific brain_ids.
"""

import asyncio
from typing import Optional

from src.logger.logging import get_logger
from src.schema.chatbot_schema import ChatWithADKRequest
from src.smart_rag.engines.traditional.orchestrator import SmartRAGOrchestrator
from src.smart_rag.core.external_api_service import ExternalApiService

logger = get_logger(__name__)


class ChatRAGService:
    """Main service for traditional RAG chat functionality.

    This service acts as the entry point for traditional RAG operations,
    coordinating between the API layer and the traditional RAG engine.
    It provides conditional routing to external APIs for specific brain_ids.

    Attributes:
        orchestrator: The traditional RAG orchestrator instance.
        external_api_service: Optional service for handling external API requests.
    """

    def __init__(self, external_api_service: Optional[ExternalApiService] = None):
        """Initialize the ChatRAGService.

        Args:
            external_api_service: Optional service for handling external API requests
        """
        self.orchestrator = SmartRAGOrchestrator()
        self.external_api_service = external_api_service

    async def process_chat_request(self, request: ChatWithADKRequest, queue: asyncio.Queue[dict]) -> None:
        """Process a traditional RAG chat request.

        Entry point for /chatbots/chatWithADK endpoint. Delegates to the
        traditional RAG orchestrator for processing or routes to external API
        based on brain_ids configuration.

        Args:
            request: The chat request containing user prompt and configuration.
            queue: AsyncIO queue for streaming response events back to client.

        Returns:
            None: Results are streamed through the queue.
        """
        logger.info(f"[SERVICE] Processing chat request - user_id: {request.user_id}, session_id: {request.session_id}")

        try:
            # Check if brain_ids require external routing
            if self._should_route_externally(request.brain_ids):
                logger.info(f"[SERVICE] Routing request to external API - session_id: {request.session_id}, brain_ids: {request.brain_ids}")
                await self.external_api_service.process_external_request(request, queue)
            else:
                logger.info(f"[SERVICE] Routing request to internal RAG - session_id: {request.session_id}")
                await self.orchestrator.chat_smart_rag(request, queue)

            logger.info(f"[SERVICE] Chat request completed successfully - session_id: {request.session_id}")
        except Exception as e:
            logger.error(f"[SERVICE] Chat request failed - session_id: {request.session_id}: {str(e)}")
            raise

    def _should_route_externally(self, brain_ids: Optional[list]) -> bool:
        """Check if any brain_id in the request matches external API configuration.

        Args:
            brain_ids: List of brain IDs from the request

        Returns:
            True if any brain_id should be routed externally, False otherwise
        """
        # If no external API service is configured, always use internal routing
        if not self.external_api_service:
            return False

        # Use the external API service to determine routing
        return self.external_api_service.should_route_externally(brain_ids)

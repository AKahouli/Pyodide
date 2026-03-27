"""Main service for multi-agent team functionality.

This module provides the high-level service interface for the /agentic/run_agent_team endpoint.
It orchestrates multi-agent team agentic_workflows using the workflow processor from the multi-agent engine.
"""

import asyncio

from src.logger.logging import get_logger
from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.engines.multi_agent.workflow_processor import run_agent_team_logic

logger = get_logger("api.routers.agentic_rag.AgentTeamService")


class AgentTeamService:
    """Main service for multi-agent team functionality.

    This service acts as the entry point for multi-agent team operations,
    coordinating between the API layer and the multi-agent engine.
    """

    async def process_team_request(self, request: RunAgentTeamRequest, queue: asyncio.Queue[dict]) -> None:
        """Process a multi-agent team request.

        Entry point for /agentic/run_agent_team endpoint. Delegates to the
        multi-agent workflow processor for orchestration.

        Args:
            request: The agent team request containing user prompt and agent configuration.
            queue: AsyncIO queue for streaming response events back to client.

        Returns:
            None: Results are streamed through the queue.
        """
        logger.info(f"[SERVICE] Processing agent team request - user_id: {request.user_id}, session_id: {request.session_id}, agent_mode: {request.agent_mode}")

        try:
            logger.info(f"[SERVICE] Routing request to internal workflow - session_id: {request.session_id}")
            await run_agent_team_logic(request, queue)

            logger.info(f"[SERVICE] Agent team request completed successfully - session_id: {request.session_id}")
        except Exception as e:
            logger.error(f"[SERVICE] Agent team request failed - session_id: {request.session_id}: {str(e)}", exc_info=True)

            raise
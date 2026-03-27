"""Dependency injection for API services.

This module provides singleton instances of services to avoid creating
new instances on every request, which causes high CPU and memory usage.
"""

from functools import lru_cache
from src.config.settings import get_settings
from src.smart_rag.core import ChatRAGService, AgentTeamService, SkillsService
from src.smart_rag.core.external_api_service import ExternalApiService
from src.smart_rag.core.single_agent_service import SingleAgentService
from src.smart_rag.core.simple_completion import SimpleCompletionService
from src.smart_rag.infrastructure.memory.memory_service import MemoryService
from src.logger.logging import get_logger

logger = get_logger("api.dependencies")


@lru_cache()
def get_chat_rag_service() -> ChatRAGService:
    """Get singleton ChatRAGService instance.

    Returns:
        ChatRAGService: Singleton service instance for RAG-based chat.
    """
    logger.info("Initializing ChatRAGService singleton")
    external_api_service = get_external_api_service()
    return ChatRAGService(external_api_service=external_api_service)


@lru_cache()
def get_external_api_service() -> ExternalApiService:
    """Get singleton ExternalApiService instance.

    Returns:
        ExternalApiService: Singleton service instance for external API integration.
    """
    logger.info("Initializing ExternalApiService singleton")
    settings = get_settings()
    return ExternalApiService(settings)


@lru_cache()
def get_agent_team_service() -> AgentTeamService:
    """Get singleton AgentTeamService instance.

    Returns:
        AgentTeamService: Singleton service instance for agent team orchestration.
    """
    logger.info("Initializing AgentTeamService singleton")
    return AgentTeamService()


@lru_cache()
def get_single_agent_service() -> SingleAgentService:
    """Get singleton SingleAgentService instance.

    Returns:
        SingleAgentService: Singleton service instance for single agent execution.
    """
    logger.info("Initializing SingleAgentService singleton")
    return SingleAgentService()


@lru_cache()
def get_simple_completion_service() -> SimpleCompletionService:
    """Get singleton SimpleCompletionService instance.

    Returns:
        SimpleCompletionService: Singleton service instance for simple chat completions.
    """
    logger.info("Initializing SimpleCompletionService singleton")
    return SimpleCompletionService()


@lru_cache()
def get_skills_service() -> SkillsService:
    """Get singleton SkillsService instance.

    Returns:
        SkillsService: Singleton service instance for agent skills management.
    """
    logger.info("Initializing SkillsService singleton")
    return SkillsService()


@lru_cache()
def get_memory_service() -> MemoryService:
    """Get singleton MemoryService instance.

    Returns:
        MemoryService: Singleton service instance for memory operations.
    """
    logger.info("Initializing MemoryService singleton")
    return MemoryService()

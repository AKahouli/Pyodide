"""Service for managing agent skills and memory.

This module provides functionality to configure agents with skills
and save their conversation context to memory.
"""

from typing import List, Dict
from src.smart_rag.infrastructure.memory.memory_service import MemoryService
from src.config.settings import get_settings
from src.logger.logging import get_logger


class SkillsService:
    """Service for managing agent skills and memory."""

    def __init__(self, settings=None):
        """Initialize the SkillsService.

        Args:
            settings: Optional settings instance. If None, will get default settings.
        """
        self._settings = settings or get_settings()
        self._logger = get_logger("api.smart_rag.skills_service")
        self.memory_service = MemoryService(self._settings)

    async def initialize(self) -> None:
        """Initialize the memory service.

        Args:
            llm_model: LLM model to use for memory operations.
        """
        await self.memory_service.initialize()
        self._logger.info(f"SkillsService initialized")

    def _build_messages_from_skills(self, skills: str, agent_name: str) -> List[Dict[str, str]]:
        """Build a list of messages from the skills context.

        Args:
            skills: The skills context as a string.
            agent_name: The name of the agent.

        Returns:
            List of messages in the format [{"role": "user/assistant", "content": "..."}]
        """
        messages = [
            {
                "role": "user",
                "content": f"Configure agent {agent_name} with the following skills comme preference utilisateur:\n{skills}",
            }
        ]
        return messages

    async def save_agent_skills(self, agent_id: str, agent_name: str, skills: str) -> bool:
        """Save agent skills to memory.

        Args:
            agent_id: The unique identifier for the agent.
            agent_name: The name of the agent.
            skills: The skills context as a string.

        Returns:
            True if successful, False otherwise.
        """
        try:
            # Build messages from skills context
            messages = self._build_messages_from_skills(skills, agent_name)

            # Save to memory using agent_id
            success = await self.memory_service.save_agent_conversation(
                messages=messages,
                agent_id=agent_id
            )

            if success:
                self._logger.info(f"Successfully saved skills for agent {agent_name} (ID: {agent_id})")
            else:
                self._logger.warning(f"Failed to save skills for agent {agent_name} (ID: {agent_id})")

            return success

        except Exception as e:
            self._logger.exception(f"Error saving skills for agent {agent_name} (ID: {agent_id}): {str(e)}")
            return False
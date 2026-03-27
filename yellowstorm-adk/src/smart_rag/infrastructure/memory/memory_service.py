"""Memory Manager for Smart RAG Agents using mem0."""
import os
import asyncio
from typing import List, Dict, Any, Optional, Tuple
from enum import Enum

from mem0 import AsyncMemory

from src.config.settings import get_settings
from src.logger.logging import get_logger

class MemoryType(Enum):
    """Enum for different memory types."""
    MANAGER = "manager"
    AGENT = "agent"

class MemoryService:
    """Memory service for Smart RAG Agents (both Manager and individual agents) using mem0.

    Implements per-loop singleton pattern for AsyncMemory to avoid creating new Azure AI Search
    connections on every request while respecting asyncio loop affinity. Each event loop gets
    its own AsyncMemory instance since async clients are bound to their creating loop.
    """

    # Configuration constants
    _EMBEDDING_DIMS = 3072
    _TEMPERATURE = 0.0
    _MAX_TOKENS = 4000
    _EMBEDDING_MODEL = "azure/text-embedding-3-large"
    _DEFAULT_MANAGER_LIMIT = 10
    _DEFAULT_AGENT_LIMIT = 10

    # Per-loop singleton instances - each event loop gets its own AsyncMemory
    _loop_memories: dict = {}  # Maps event loop to AsyncMemory instance
    # Per-loop locks to avoid blocking event loop during initialization
    _locks: dict = {}  # Maps event loop to its asyncio.Lock

    def __init__(self, settings: Optional[Any] = None):
        """Initialize mem0 Memory with Azure configuration.

        Args:
            settings: Optional settings instance. If None, will get default settings.
        """
        self._settings = settings or get_settings()
        self._logger = get_logger("api.smart_rag.memory_manager")
        self._config = self._build_config(self._settings.MEMORY_MODEL)

    def _build_config(self, model: str) -> Dict[str, Any]:
        """Build configuration dictionary for mem0.

        Args:
            model: LLM model to use

        Returns:
            Configuration dictionary for AsyncMemory initialization.
        """
        try:
            return {
                "vector_store": {
                    "provider": "qdrant",
                    "config": {
                        "url": self._settings.QDRANT_URL,
                        "collection_name": self._settings.QDRANT_COLLECTION_NAME,
                        "api_key": self._settings.QDRANT_API_KEY,
                        "embedding_model_dims": self._settings.EMBEDDING_DIMS,
                    },
                },
                "llm": {
                    "provider": "litellm",
                    "config": {
                        "model": model,
                        "temperature": self._TEMPERATURE,
                        "max_tokens": self._MAX_TOKENS,
                        "api_key": self._settings.LITELLM_API_SECRET_KEY,
                    },
                },
                "embedder": {
                    "provider": "openai",
                    "config": {
                        "model": self._EMBEDDING_MODEL,
                        "api_key": self._settings.LITELLM_API_SECRET_KEY,
                        "openai_base_url": self._settings.LITELLM_API_BASE_URL,
                        "embedding_dims": self._EMBEDDING_DIMS,
                    },
                },
            }
        except Exception as e:
            self._logger.exception(f"Failed to build config of MemoryService: {str(e)}")
            return {}

    @property
    def memory(self) -> Optional[AsyncMemory]:
        """Get AsyncMemory instance for the current event loop (synchronous property).

        Returns:
            AsyncMemory instance for current loop or None if not initialized.
        """
        try:
            loop = asyncio.get_running_loop()
            return MemoryService._loop_memories.get(loop)
        except RuntimeError:
            # No running event loop
            return None

    async def initialize(self) -> None:
        """Ensure AsyncMemory instance is initialized for the current event loop.

        This method uses double-checked locking pattern with per-loop asyncio.Lock
        to avoid blocking the event loop. Each event loop gets its own AsyncMemory
        instance to respect asyncio loop affinity (async clients are bound to their
        creating loop).
        """
        # Get or create lock for current event loop
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No event loop running, this shouldn't happen in async context
            self._logger.error("No running event loop found during MemoryService initialization")
            return

        # Check if this loop already has an initialized memory instance
        if loop not in MemoryService._loop_memories:
            # Get or create lock for this specific event loop
            if loop not in MemoryService._locks:
                MemoryService._locks[loop] = asyncio.Lock()

            lock = MemoryService._locks[loop]

            # Use async lock to avoid blocking the event loop
            async with lock:
                # Double-check after acquiring lock
                if loop not in MemoryService._loop_memories:
                    await self._initialize_loop_memory(loop)

    async def _initialize_loop_memory(self, loop) -> None:
        """Initialize AsyncMemory instance for specific event loop (internal use only).

        This method should only be called within the lock in initialize().

        Args:
            loop: The event loop to create AsyncMemory for
        """
        self._set_environment_variables()

        try:
            memory_instance = await AsyncMemory.from_config(self._config)
            MemoryService._loop_memories[loop] = memory_instance
            self._logger.info(f"MemoryService initialized successfully for event loop {id(loop)} with model: {self._settings.MEMORY_MODEL}")
        except Exception as e:
            self._logger.exception(f"Failed to initialize MemoryService for event loop {id(loop)}: {str(e)}")
            # Don't store None, just skip this loop
            pass

    def _set_environment_variables(self) -> None:
        """Set required environment variables for mem0."""
        try:
            os.environ["OPENAI_API_KEY"] = self._settings.LITELLM_API_SECRET_KEY
            os.environ["OPENAI_BASE_URL"] = self._settings.LITELLM_API_BASE_URL
            os.environ["MEM0_TELEMETRY"] = "False"
        except Exception as e:
            self._logger.exception(f"Failed to _set_environment_variables MemoryService: {str(e)}")

    def _is_memory_available(self) -> bool:
        """Check if memory service is available for current event loop.

        Returns:
            True if memory is initialized for current loop, False otherwise.
        """
        try:
            loop = asyncio.get_running_loop()
            is_available = loop in MemoryService._loop_memories
            if not is_available:
                self._logger.warning(f"Memory service not available for event loop {id(loop)}")
            return is_available
        except RuntimeError:
            self._logger.warning("No running event loop, memory service not available")
            return False

    def _validate_inputs(self, message: str, identifier: str, identifier_name: str) -> bool:
        """Validate common inputs for memory operations.

        Args:
            message: The message/query to validate
            identifier: The identifier (user_id or agent_id) to validate
            identifier_name: Name of the identifier for logging

        Returns:
            True if inputs are valid, False otherwise
        """
        if not message.strip():
            self._logger.warning("Empty message provided")
            return False

        if not identifier.strip():
            self._logger.warning(f"Empty {identifier_name} provided")
            return False

        return True

    def _format_memories(self, results: List[Dict[str, Any]]) -> str:
        """Format memory search results into a readable string.

        Args:
            results: List of memory search results.

        Returns:
            Formatted string of memories, empty string if no valid memories.
        """
        if not results:
            return ""

        memories_list = [
            f"- {entry['memory']}"
            for entry in results
            if entry.get('memory')
        ]

        return "\n".join(memories_list)

    async def _search_memories(self, query: str, id: str, limit: int, memory_type: MemoryType) -> str:
        """Core memory search functionality .

        Args:
            query: Search query
            id: User or agent identifier for memory namespace
            limit: Maximum number of memories to retrieve

        Returns:
            Formatted string of relevant memories
        """

        if not self._is_memory_available():
            return ""
        try:
            self._logger.info(f"[MEMORY SERVICE] Searching {memory_type.value} memories - id: {id}, limit: {limit}")

            if memory_type == MemoryType.MANAGER:
                relevant_memories = await self.memory.search(
                    query=query,
                    user_id=id,
                    limit=limit
                )

                if not relevant_memories or not relevant_memories.get("results"):
                    self._logger.info(f"[MEMORY SERVICE] No {memory_type.value} memories found for {id}")
                    return ""

                results_count = len(relevant_memories["results"])
                self._logger.info(f"[MEMORY SERVICE] Retrieved {results_count} {memory_type.value} memories for {id}")
                return self._format_memories(relevant_memories["results"])

            else:
                relevant_memories = await self.memory.search(
                    query=str(query), agent_id=id, limit=limit
                )

                if not relevant_memories or not relevant_memories.get("results"):
                    self._logger.info(f"[MEMORY SERVICE] No {memory_type.value} memories found for {id}")
                    return ""

                results_count = len(relevant_memories["results"])
                self._logger.info(f"[MEMORY SERVICE] Retrieved {results_count} {memory_type.value} memories for {id}")
                return self._format_memories(relevant_memories["results"])

        except Exception as e:
            self._logger.exception(f"[MEMORY SERVICE] Failed to retrieve {memory_type.value} memories for {id}: {str(e)}")
            return ""

    async def get_relevant_memories(self, user_message: str, user_id: str, limit: int = None) -> str:
        """Retrieve relevant memories for the manager agent.

        Args:
            user_message: The current user message
            user_id: User identifier
            limit: Maximum number of memories to retrieve

        Returns:
            Formatted string of relevant memories
        """
        limit = limit if limit is not None else self._DEFAULT_MANAGER_LIMIT
        return await self._search_memories(user_message, user_id, limit, MemoryType.MANAGER)

    async def _save_conversation(self, messages: List[Dict[str, str]], id: str,
                                memory_type: MemoryType) -> bool:
        """Core conversation saving functionality.

        Args:
            messages: List of messages to save
            id: User or agent identifier for memory namespace
            memory_type: Type of memory (manager or agent)

        Returns:
            True if successful, False otherwise
        """
        if not messages:
            self._logger.warning("[MEMORY SERVICE] Empty messages list provided")
            return False

        if not self._is_memory_available():
            return False

        try:
            messages_count = len(messages)
            self._logger.info(f"[MEMORY SERVICE] Saving {messages_count} {memory_type.value} messages to memory - id: {id}")

            if memory_type == MemoryType.MANAGER:
                await self.memory.add(messages, user_id=id)
                self._logger.info(f"[MEMORY SERVICE] Successfully saved {memory_type.value} conversation for {id}")
                return True
            else:
                await self.memory.add(messages, agent_id=id)
                self._logger.info(f"[MEMORY SERVICE] Successfully saved {memory_type.value} conversation for {id}")
                return True
        except Exception as e:
            self._logger.exception(f"[MEMORY SERVICE] Failed to save {memory_type.value} conversation for {id}: {str(e)}")
            return False

    async def save_manager_conversation(self, messages: List[Dict[str, str]], user_id: str) -> bool:
        """Save manager conversation to memory.

        Args:
            messages: List of messages in format [{"role": "user/assistant", "content": "..."}]
            user_id: User identifier

        Returns:
            True if successful, False otherwise
        """
        return await self._save_conversation(messages, user_id, MemoryType.MANAGER)

    def _create_memory_context(self, memories: str, memory_type: MemoryType, entity_id: str) -> str:
        """Create formatted memory context string.

        Args:
            memories: Formatted memories string
            memory_type: Type of memory context
            entity_id: Entity identifier (user_id or agent_id)

        Returns:
            Formatted memory context string
        """
        if not memories:
            return ""

        if memory_type == MemoryType.MANAGER:
            return f"\n\n< manager_memories >\nRelevant memories from previous conversations:\n{memories}\n< /manager_memories >"
        else:
            return f"\n\n< agent_memories >\nRelevant memories from previous tasks for {entity_id}:\n{memories}\n< /agent_memories >"

    async def create_manager_context(self, user_message: str, user_id: str) -> str:
        """Create enriched context for manager agent with relevant memories.

        Args:
            user_message: Current user message
            user_id: User identifier

        Returns:
            Formatted memory context string
        """
        memories = await self.get_relevant_memories(user_message, user_id)
        return self._create_memory_context(memories, MemoryType.MANAGER, user_id)

    async def get_agent_memories(self, user_message: str, agent_id: str, limit: int = None) -> str:
        """Retrieve relevant memories for a specific agent using only agent_id.

        Args:
            user_message: The current user message/task
            agent_id: The specific agent identifier (e.g., "search_agent", "manager")
            limit: Maximum number of memories to retrieve

        Returns:
            Formatted string of relevant memories for this agent
        """
        limit = limit if limit is not None else self._DEFAULT_AGENT_LIMIT
        return await self._search_memories(user_message, agent_id, limit, MemoryType.AGENT)

    async def save_agent_conversation(self, messages: List[Dict[str, str]], agent_id: str) -> bool:
        """Save agent conversation to memory using only agent_id.

        Args:
            messages: List of messages in format [{"role": "user/assistant", "content": "..."}]
            agent_id: The specific agent identifier
            task_description: Optional task description for better context

        Returns:
            True if successful, False otherwise
        """
        return await self._save_conversation(messages, agent_id, MemoryType.AGENT)

    async def create_agent_context(self, user_message: str, agent_id: str) -> str:
        """Create enriched context for an agent with relevant memories using only agent_id.

        Args:
            user_message: Current user message/task
            agent_id: The specific agent identifier

        Returns:
            Formatted memory context string for the agent
        """
        memories = await self.get_agent_memories(user_message, agent_id)
        return self._create_memory_context(memories, MemoryType.AGENT, agent_id)

    async def clear_agent_memory(self, agent_id: str) -> bool:
        """Clear all memories for a specific agent.

        Args:
            agent_id: The specific agent identifier

        Returns:
            True if successful, False otherwise
        """
        if not agent_id.strip():
            self._logger.warning("[MEMORY SERVICE] Empty agent_id provided")
            return False

        if not self._is_memory_available():
            return False

        try:
            self._logger.info(f"[MEMORY SERVICE] Clearing all memories for agent: {agent_id}")
            await self.memory.delete_all(agent_id=agent_id)
            self._logger.info(f"[MEMORY SERVICE] Successfully cleared all memories for agent {agent_id}")
            return True
        except Exception as e:
            self._logger.exception(f"[MEMORY SERVICE] Failed to clear memories for agent {agent_id}: {str(e)}")
            return False

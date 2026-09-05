"""Helpers for managing ADK sessions."""
import asyncio
import uuid
from typing import Any, Dict, List, Optional
from threading import Lock

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService, Session

from sqlalchemy.ext.asyncio import create_async_engine

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.smart_rag.infrastructure.processing.plugin import CleanSessionPlugin

logger = get_logger("api.smart_rag.session_helper")
settings = get_settings()
APP_NAME = "manager_app"
DEFAULT_AGENT_NAME = "unknown"
# Parallel Session Manager - shared engine with async coordination
_shared_engine = None
_engine_lock = asyncio.Lock()
_shared_session_service = None
_session_service_lock = asyncio.Lock()


async def get_shared_engine(db_url: str):
    """Get or create shared SQLAlchemy engine"""
    global _shared_engine

    # Fast path: engine already exists
    if _shared_engine is not None:
        return _shared_engine

    async with _engine_lock:
        # Double-check pattern
        if _shared_engine is None:
            try:
                # Ensure DB URL uses async driver
                async_db_url = db_url
                if db_url.startswith("postgresql://"):
                    async_db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

                _shared_engine = create_async_engine(
                    async_db_url,
                    pool_pre_ping=True,
                    pool_recycle=settings.DB_POOL_RECYCLE,
                    pool_size=settings.get_effective_pool_size(),
                    max_overflow=settings.get_effective_max_overflow(),
                    pool_timeout=settings.DB_POOL_TIMEOUT,
                    connect_args={
                        "server_settings": {"statement_timeout": "10000"},  # 10 seconds in ms
                    },
                )
            except Exception as e:
                logger.error(f"Failed to create shared database engine: {str(e)}")
                raise

    return _shared_engine


async def dispose_shared_engine():
    """Dispose shared engine during shutdown."""
    global _shared_engine
    if _shared_engine is not None:
        logger.info("Disposing shared database engine...")
        await _shared_engine.dispose()
        _shared_engine = None
        logger.info("Shared database engine disposed")


async def get_shared_database_session_service():
    """Return the one warmed session service for this process.

    Built lazily (startup or first request) on the shared pooled engine:
    engine creation, service construction, and ``prepare_tables()`` are paid
    once here instead of on every request's critical path. The service holds
    no request-specific state; request diagnostics stay in ContextVars.
    """
    global _shared_session_service

    # Fast path: service already warmed.
    if _shared_session_service is not None:
        return _shared_session_service

    async with _session_service_lock:
        # Double-check pattern: another waiter may have warmed it already.
        if _shared_session_service is not None:
            return _shared_session_service

        engine = await get_shared_engine(settings.DATABASE_URL)

        from src.smart_rag.infrastructure.monitoring.instrumented_database_session_service import (
            InstrumentedDatabaseSessionService,
        )

        service = InstrumentedDatabaseSessionService(db_engine=engine)
        # ADK 2.8 public startup API: pay schema checks/creation before the
        # service is published so request-path calls fast-return.
        await service.prepare_tables()

        _shared_session_service = service
        return service


async def dispose_shared_database_session_service():
    """Clear the shared session service during shutdown.

    The service does not own the shared engine (it was injected via
    ``db_engine=``), so ``close()`` releases no engine resources; the engine
    itself is disposed exactly once by :func:`dispose_shared_engine`.
    """
    global _shared_session_service
    service = _shared_session_service
    _shared_session_service = None
    if service is not None:
        await service.close()


class SessionHelper:
    """Utility class to manage sessions and runners for a user."""

    def __init__(self, user_id: str) -> None:
        self.user_id = user_id
        self.session_service: Optional[DatabaseSessionService] = None
        self.session: Optional[Session] = None
        self.session_id: Optional[str] = None
        self.runner: Optional[Runner] = None
        self.exit_stacks: List[Any] = []

    def _extract_tool_data(self, tool: Any) -> Dict[str, str]:
        """Extract information from a single tool.

        Args:
            tool: The tool object to extract information from

        Returns:
            Dict[str, str]: Dictionary containing 'name', 'description', and 'prompt'
        """
        # Check if tool is a function (delegate function)
        if callable(tool):
            return {
                'name': getattr(tool, '__name__', 'unknown'),
                'description': getattr(tool, '__doc__', ''),
                'prompt': ''  # Delegate functions don't have separate prompts
            }

        # Check if tool is an object with attributes
        if hasattr(tool, 'name'):
            return {
                'name': getattr(tool, 'name', 'unknown'),
                'description': getattr(tool, 'description', ''),
                'prompt': getattr(tool, 'prompt', '')
            }

        # Fallback for unknown tool types
        return {
            'name': str(type(tool).__name__),
            'description': str(tool),
            'prompt': ''
        }

    def _extract_tools_info(self, agent: Agent) -> List[Dict[str, str]]:
        """Extract tools information from agent.

        Args:
            agent: The agent object containing tools

        Returns:
            List[Dict[str, str]]: List of dictionaries containing tool name, description, and prompt
        """
        tools_info = []
        try:
            if not (hasattr(agent, 'tools') and agent.tools):
                return tools_info

            for tool in agent.tools:
                tool_data = self._extract_tool_data(tool)
                tools_info.append(tool_data)

            if tools_info:
                logger.info(f"Extracted {len(tools_info)} tools from agent")

        except Exception as e:
            logger.error(f"Failed to extract tools info from agent: {str(e)}")

        return tools_info

    def _extract_agent_metadata(self, agent: Agent) -> tuple[Optional[str], str]:
        """Extract system prompt and agent name from agent.

        Args:
            agent: The agent object to extract metadata from

        Returns:
            tuple: (system_prompt, agent_name)
        """
        system_prompt = getattr(agent, 'instruction', None) if hasattr(agent, 'instruction') else None
        agent_name = getattr(agent, 'name', DEFAULT_AGENT_NAME) if hasattr(agent, 'name') else DEFAULT_AGENT_NAME
        return system_prompt, agent_name

    async def init_session(self, agent: Agent, session_id: Optional[str] = None) -> str:
        """Initialize session and runner for the given agent - parallel version.

        Args:
            agent: The agent instance to create a session for
            session_id: Optional session ID. If not provided, a new one will be generated

        Returns:
            str: The session ID

        Raises:
            Exception: If session initialization fails
        """
        try:
            # Shared warmed service: engine creation and prepare_tables() are
            # paid once per process, not per request.
            self.session_service = await get_shared_database_session_service()

            self.session_id = session_id or f"session-{uuid.uuid4()}"

            # Extract agent metadata and tools
            system_prompt, agent_name = self._extract_agent_metadata(agent)
            tools_info = self._extract_tools_info(agent)

            # Create or retrieve session - calls _find_existing_session
            extra_state = {}
            if hasattr(agent, "_mcp_search_state"):
                extra_state.update(agent._mcp_search_state)

            self.session = await self.set_session(
                system_prompt=system_prompt,
                agent_name=agent_name,
                tools_info=tools_info,
                extra_state=extra_state
            )

            # Initialize runner with clean session plugin
            self.runner = Runner(
                agent=agent,
                app_name=APP_NAME,
                session_service=self.session_service,
                plugins=[CleanSessionPlugin()],
            )

            return self.session_id
        except Exception as e:
            logger.error(f"init_session failed for user {self.user_id}: {str(e)}")
            raise

    def _build_session_state(
        self,
        system_prompt: Optional[str],
        agent_name: str,
        tools_info: Optional[List[Dict[str, str]]]
    ) -> Dict[str, Any]:
        """Build session state dictionary from provided data.

        Args:
            system_prompt: Optional system prompt for the agent
            agent_name: Name of the agent
            tools_info: Optional list of tool information dictionaries

        Returns:
            Dict[str, Any]: Session state dictionary
        """
        state = {}

        if system_prompt:
            state["system_prompt"] = system_prompt
            state["agent_name"] = agent_name
            logger.info(
                f"Storing system prompt for agent '{agent_name}' "
                f"in session state for session {self.session_id}"
            )

        if tools_info:
            state["tools_info"] = tools_info
            logger.info(
                f"Storing {len(tools_info)} tools information "
                f"in session state for session {self.session_id}"
            )

        return state

    async def _find_existing_session(self) -> Optional[Session]:
        """Find existing session by ID.

        Returns:
            Optional[Session]: Existing session if found, None otherwise
        """
        try:
            result = await self.session_service.get_session(
                app_name=APP_NAME,
                user_id=self.user_id,
                session_id=self.session_id
            )
            return result
        except Exception as e:
            logger.error(f"Failed to find existing session {self.session_id} for user {self.user_id}: {str(e)}")
            return None

    async def set_session(
        self,
        system_prompt: Optional[str] = None,
        agent_name: str = DEFAULT_AGENT_NAME,
        tools_info: Optional[List[Dict[str, str]]] = None,
        extra_state: Optional[Dict[str, Any]] = None
    ) -> Session:
        """Create or retrieve a session with the given parameters.

        Args:
            system_prompt: Optional system prompt for the agent
            agent_name: Name of the agent (defaults to DEFAULT_AGENT_NAME)
            tools_info: Optional list of tool information dictionaries
            extra_state: Optional additional state to merge into session state

        Returns:
            Session: The created or retrieved session

        Raises:
            Exception: If session creation or retrieval fails
        """
        try:
            # Try to find existing session
            existing_session = await self._find_existing_session()
            if existing_session:
                return existing_session

            # Create new session with state
            state = self._build_session_state(system_prompt, agent_name, tools_info)
            if extra_state:
                state.update(extra_state)
            return await self.session_service.create_session(
                app_name=APP_NAME,
                user_id=self.user_id,
                session_id=self.session_id,
                state=state or None
            )

        except Exception as e:
            logger.error(f"Failed to set session {self.session_id} for user {self.user_id}: {str(e)}")
            raise

    async def get_system_prompt(self) -> Optional[Dict[str, str]]:
        """Retrieve system prompt and agent name from session state.

        Returns:
            Optional[Dict[str, str]]: Dictionary with keys 'system_prompt' and 'agent_name',
                                     or None if not found or no session exists
        """
        try:
            if not (self.session and self.session.state):
                return None

            system_prompt = self.session.state.get("system_prompt")
            if not system_prompt:
                return None

            agent_name = self.session.state.get("agent_name", DEFAULT_AGENT_NAME)
            return {
                "system_prompt": system_prompt,
                "agent_name": agent_name
            }

        except Exception as e:
            logger.error(f"Failed to retrieve system prompt for session {self.session_id}: {str(e)}")
            return None

    async def get_tools_info(self) -> Optional[List[Dict[str, str]]]:
        """Retrieve tools information from session state.

        Returns:
            Optional[List[Dict[str, str]]]: List of tool information dictionaries with keys
                                           'name', 'description', and 'prompt', or None if not found
        """
        try:
            if not (self.session and self.session.state):
                return None

            return self.session.state.get("tools_info")

        except Exception as e:
            logger.error(f"Failed to retrieve tools info for session {self.session_id}: {str(e)}")
            return None

    def add_exit_stack(self, stack: Any) -> None:
        """Add exit stack for cleanup."""

        self.exit_stacks.append(stack)

    async def cleanup(self) -> None:
        """Clean up resources and dispose database connections."""

        try:
            for stack in self.exit_stacks:
                if hasattr(stack, "aclose"):
                    await stack.aclose()

            # Note: We don't dispose the shared engine here as it's shared across all sessions
            # The shared engine is disposed during application shutdown via dispose_shared_engine()

            self.session_service = None
            self.session = None
            self.runner = None
            self.exit_stacks = []
        except Exception as e:
            logger.error(f"Error during session cleanup for user {self.user_id}: {str(e)}")
            raise



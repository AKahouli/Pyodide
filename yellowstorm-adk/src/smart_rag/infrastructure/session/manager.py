"""Helpers for managing ADK sessions."""
import asyncio
import uuid
import time
from typing import Any, Dict, List, Optional
from threading import Lock

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService, Session
from google.adk.sessions.database_session_service import Base
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

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


async def get_shared_engine(db_url: str):
    """Get or create shared SQLAlchemy engine"""
    global _shared_engine

    start_time = time.time()

    # Fast path: engine already exists
    if _shared_engine is not None:
        logger.info(f"[FREEZE DEBUG] get_shared_engine returning existing engine (fast path) in {time.time() - start_time:.3f}s")
        return _shared_engine

    # Slow path: create engine
    logger.info("[FREEZE DEBUG] get_shared_engine: engine doesn't exist, waiting for lock...")
    lock_start = time.time()
    async with _engine_lock:
        lock_duration = time.time() - lock_start
        logger.info(f"[FREEZE DEBUG] get_shared_engine: acquired lock after {lock_duration:.2f}s")

        # Double-check pattern
        if _shared_engine is None:
            try:
                logger.info("[FREEZE DEBUG] Creating shared database engine for parallel access...")
                create_start = time.time()

                # Ensure DB URL uses async driver
                async_db_url = db_url
                if db_url.startswith("postgresql://"):
                    async_db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
                    logger.info(f"[FREEZE DEBUG] Converting DB URL to use asyncpg driver")

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
                create_duration = time.time() - create_start
                logger.info(f"[FREEZE DEBUG] Shared async database engine created in {create_duration:.2f}s")
            except Exception as e:
                logger.error(f"Failed to create shared database engine: {str(e)}")
                raise
        else:
            logger.info("[FREEZE DEBUG] Engine was created by another request while we waited for lock")

    total_duration = time.time() - start_time
    logger.info(f"[FREEZE DEBUG] get_shared_engine completed in {total_duration:.2f}s")
    return _shared_engine


async def dispose_shared_engine():
    """Dispose shared engine during shutdown."""
    global _shared_engine
    if _shared_engine is not None:
        logger.info("Disposing shared database engine...")
        await _shared_engine.dispose()
        _shared_engine = None
        logger.info("Shared database engine disposed")


class PatchedDatabaseSessionService(DatabaseSessionService):
    """Database session service with tuned connection pooling."""

    def __init__(self, db_url: str) -> None:
        # Use the shared global engine - this requires the engine to be already created
        logger.info("[FREEZE DEBUG] PatchedDatabaseSessionService.__init__ STARTED")
        global _shared_engine
        if _shared_engine is None:
            raise RuntimeError("Shared engine not initialized. Call await get_shared_engine() first.")

        # Initialize parent class to set up all required attributes
        # Pass the async URL to parent
        async_db_url = db_url
        if db_url.startswith("postgresql://"):
            async_db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        super().__init__(async_db_url)

        # Replace the engine with our shared async engine
        self.db_engine = _shared_engine
        self.database_session_factory = async_sessionmaker(bind=self.db_engine, expire_on_commit=False)

class SessionHelper:
    """Utility class to manage sessions and runners for a user."""

    def __init__(self, user_id: str) -> None:
        self.user_id = user_id
        self.session_service: Optional[PatchedDatabaseSessionService] = None
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
            start_time = time.time()
            logger.info(f"[FREEZE DEBUG] init_session STARTED for user {self.user_id}")

            # Ensure shared engine is ready, then create session service
            engine_start = time.time()
            logger.info(f"[FREEZE DEBUG] Calling get_shared_engine()")
            await get_shared_engine(settings.DATABASE_URL)
            engine_duration = time.time() - engine_start
            logger.info(f"[FREEZE DEBUG] get_shared_engine() completed in {engine_duration:.2f}s")

            # POTENTIAL FREEZE POINT #1: PatchedDatabaseSessionService calls create_all()
            service_start = time.time()
            logger.info(f"[FREEZE DEBUG] Creating PatchedDatabaseSessionService - will call create_all()")
            self.session_service = PatchedDatabaseSessionService(settings.DATABASE_URL)
            service_duration = time.time() - service_start
            logger.info(f"[FREEZE DEBUG] PatchedDatabaseSessionService created in {service_duration:.2f}s")

            self.session_id = session_id or f"session-{uuid.uuid4()}"
            logger.info(f"[FREEZE DEBUG] Session ID: {self.session_id}")

            # Extract agent metadata and tools
            extract_start = time.time()
            system_prompt, agent_name = self._extract_agent_metadata(agent)
            tools_info = self._extract_tools_info(agent)
            extract_duration = time.time() - extract_start
            logger.info(f"[FREEZE DEBUG] Agent metadata extracted in {extract_duration:.2f}s")

            # Create or retrieve session - calls _find_existing_session
            set_session_start = time.time()
            logger.info(f"[FREEZE DEBUG] Calling set_session() - will call _find_existing_session()")
            self.session = await self.set_session(
                system_prompt=system_prompt,
                agent_name=agent_name,
                tools_info=tools_info
            )
            set_session_duration = time.time() - set_session_start
            logger.info(f"[FREEZE DEBUG] set_session() completed in {set_session_duration:.2f}s")

            # Initialize runner with clean session plugin
            runner_start = time.time()
            self.runner = Runner(
                agent=agent,
                app_name=APP_NAME,
                session_service=self.session_service,
                plugins=[CleanSessionPlugin()],
            )
            runner_duration = time.time() - runner_start
            logger.info(f"[FREEZE DEBUG] Runner created in {runner_duration:.2f}s")

            total_duration = time.time() - start_time
            logger.info(f"[FREEZE DEBUG] init_session COMPLETED in {total_duration:.2f}s")

            return self.session_id
        except Exception as e:
            total_duration = time.time() - start_time
            logger.error(f"[FREEZE DEBUG] init_session FAILED after {total_duration:.2f}s for user {self.user_id}: {str(e)}")
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
        start_time = time.time()
        try:
            logger.info(f"[FREEZE DEBUG] _find_existing_session STARTED for session {self.session_id}, user {self.user_id}")
            result = await self.session_service.get_session(
                app_name=APP_NAME,
                user_id=self.user_id,
                session_id=self.session_id
            )
            duration = time.time() - start_time
            if result:
                logger.info(f"[FREEZE DEBUG] _find_existing_session FOUND existing session in {duration:.3f}s")
            else:
                logger.info(f"[FREEZE DEBUG] _find_existing_session NO session found in {duration:.3f}s")
            return result
        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"[FREEZE DEBUG] _find_existing_session FAILED after {duration:.3f}s for session {self.session_id}, user {self.user_id}: {str(e)}")
            return None

    async def set_session(
        self,
        system_prompt: Optional[str] = None,
        agent_name: str = DEFAULT_AGENT_NAME,
        tools_info: Optional[List[Dict[str, str]]] = None
    ) -> Session:
        """Create or retrieve a session with the given parameters.

        Args:
            system_prompt: Optional system prompt for the agent
            agent_name: Name of the agent (defaults to DEFAULT_AGENT_NAME)
            tools_info: Optional list of tool information dictionaries

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



"""Module for re-executing manager agent after playbook step modification."""

import asyncio
import time
from typing import Optional, Dict, Any
from google.adk import Runner
from google.adk.sessions import DatabaseSessionService
from sqlalchemy.exc import SQLAlchemyError

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.schema.playbook import RunPlaybookStepRequest
from src.smart_rag.infrastructure.processing.plugin import CleanSessionPlugin
from src.smart_rag.agents.core.helpers import AgentHelper
from src.smart_rag.agents.core.document_helpers import DocumentHelpers
from src.smart_rag.agents.core.repository import AgentRepository
from src.smart_rag.agents.factories.delegation_factory import AgentDelegationFactory
from src.smart_rag.agents.tools.tools_manager import AgentToolsManager
from src.smart_rag.agents.factories.manager_factory import ManagerAgentFactory
from src.smart_rag.tools.infrastructure.tool_descriptions import ToolDescriptionProvider
from src.smart_rag.infrastructure.processing.context_builder import ContextBuilder
from src.smart_rag.engines.multi_agent.streaming_processor import StreamingEventProcessor
from src.smart_rag.infrastructure.memory.memory_service import MemoryService

# Constants
DEFAULT_MODEL = 'gpt-5.4-mini'
AGENT_MODE_PREFIX = "Agent_mode_"
MANAGER_EXECUTION_TIMEOUT = 600  # 10 minutes in seconds

logger = get_logger("api.smart_rag.playbook_dir.execute_manager")
settings = get_settings()


class PlaybookManagerExecutor:
    """Service for re-executing manager agent after step modification."""

    def __init__(
        self,
        agent_factory,
        agent_runner,
        streaming_formatter,
        prompt_processor,
        llm_factory,
        config
    ):
        """Initialize the PlaybookManagerExecutor.

        Args:
            agent_factory: Factory for creating agents
            agent_runner: Runner for executing agents
            streaming_formatter: Formatter for streaming responses
            prompt_processor: Processor for prompts
            llm_factory: Factory for LLM instances
            config: Configuration object with session details
        """
        self.agent_factory = agent_factory
        self.agent_runner = agent_runner
        self.streaming_formatter = streaming_formatter
        self.prompt_processor = prompt_processor
        self.llm_factory = llm_factory
        self.config = config

        # Initialize components (same as team_orchestrator)
        self.agent_helper = AgentHelper()
        self.document_helper = DocumentHelpers()
        self.agent_repository = AgentRepository(self.agent_helper)
        self.context_builder = ContextBuilder()
        self.tool_description_provider = ToolDescriptionProvider()
        # The citation manager will be initialized per request using the registry
        self.citation_manager = None

        # Initialize delegation factory
        self.delegation_factory = AgentDelegationFactory(
            self.config,
            self.agent_factory,
            self.agent_runner,
            self.agent_repository,
            self.agent_helper,
            self.tool_description_provider,
            self.citation_manager
        )

        # Initialize agent tools manager
        self.agent_tools_manager = AgentToolsManager(
            self.agent_repository,
            self.delegation_factory,
            self.agent_helper
        )

        # Initialize manager factory
        self.manager_factory = ManagerAgentFactory(
            self.config,
            self.prompt_processor,
            llm_factory,
            self.agent_repository,
            self.tool_description_provider,
            self.context_builder,
            self.agent_helper
        )

        # Initialize streaming processor
        self.streaming_processor = StreamingEventProcessor(
            self.config,
            streaming_formatter
        )

        # Initialize memory service
        self.memory_service = MemoryService()

    def _extract_tool_data(self, tool: Any) -> Dict[str, str]:
        """Extract information from a single tool.

        Args:
            tool: The tool object to extract information from

        Returns:
            Dict[str, str]: Dictionary containing 'name', 'description', and 'prompt'
        """
        if callable(tool):
            return {
                'name': getattr(tool, '__name__', 'unknown'),
                'description': getattr(tool, '__doc__', ''),
                'prompt': ''
            }

        if hasattr(tool, 'name'):
            return {
                'name': getattr(tool, 'name', 'unknown'),
                'description': getattr(tool, 'description', ''),
                'prompt': getattr(tool, 'prompt', '')
            }

        return {
            'name': str(type(tool).__name__),
            'description': str(tool),
            'prompt': ''
        }

    async def execute_manager(
        self,
        request: RunPlaybookStepRequest,
        session_id: str,
        queue: asyncio.Queue[dict],
        all_agents: list
    ) -> str:
        """Re-execute the manager agent with updated context.

        This function:
        1. Sets up all agents in the repository
        2. Creates tools from all agents
        3. Creates manager agent using manager_factory (same as team_orchestrator)
        4. Creates session and runner
        5. Executes manager via streaming_processor

        Args:
            request: The playbook step request containing manager config
            session_id: Session ID with updated context (modified step result)
            queue: Queue for streaming responses
            all_agents: List of all agent configurations (for delegation)

        Returns:
            Manager agent result (final response)
        """
        try:
            logger.info(
                f"[PLAYBOOK MANAGER] Starting manager re-execution - "
                f"session_id: {session_id}, "
                f"agent_count: {len(all_agents)}"
            )

            # Step 1: Set up agents in repository for delegation
            self.agent_repository.set_agents(all_agents)

            # Step 4: Prepare manager prompt
            manager_prompt = request.manager_agent.prompt
            enriched_manager_prompt = manager_prompt

            # Check if memory is enabled
            manager_memory = request.manager_agent.save_memory
            if manager_memory:
                try:
                    await self.memory_service.initialize()
                    self.delegation_factory.set_memory_service(self.memory_service)

                    # Create memory context (reconstruct user prompt from task)
                    user_prompt = f"Task: {request.taskDescription}"
                    memory_context = await self.memory_service.create_manager_context(
                        user_prompt,
                        request.userId
                    )
                    enriched_manager_prompt = manager_prompt + memory_context
                    logger.info(
                        f"[PLAYBOOK MANAGER] Manager memory enabled - session_id: {session_id}"
                    )
                except Exception as e:
                    logger.warning(
                        f"[PLAYBOOK MANAGER] Failed to initialize memory service (continuing without memory): {str(e)}"
                    )
            else:
                logger.info(
                    f"[PLAYBOOK MANAGER] Manager memory disabled - session_id: {session_id}"
                )

            # Step 5: Create tools from all agents (same as team_orchestrator line 419)
            try:
                tools = self.agent_tools_manager.create_tools_from_all_agents(queue, True)
                logger.info(
                    f"[PLAYBOOK MANAGER] Created {len(tools)} tools from agents"
                )
            except Exception as e:
                error_msg = f"Failed to create tools from agents: {str(e)}"
                logger.error(f"[PLAYBOOK MANAGER] {error_msg}")
                raise RuntimeError(error_msg) from e

            # Step 6: Extract manager temperature from agent params
            manager_temperature = None
            if request.manager_agent.agent_params:
                manager_temperature = request.manager_agent.agent_params.get('temperature')

            # Step 7: Create manager agent using manager_factory (same as team_orchestrator line 421)
            # Use tool_choice='none' to prevent delegation during playbook re-execution
            # The manager should only synthesize the results from already-executed steps
            try:
                manager_agent = self.manager_factory.create_manager_agent(
                    enriched_manager_prompt,
                    tools,
                    self.delegation_factory,
                    manager_temperature,
                    tool_choice="none"
                )
                logger.info(
                    f"[PLAYBOOK MANAGER] Manager agent created with tool_choice='none': {request.manager_agent.name}"
                )
            except Exception as e:
                error_msg = f"Failed to create manager agent: {str(e)}"
                logger.error(f"[PLAYBOOK MANAGER] {error_msg}")
                raise RuntimeError(error_msg) from e

            # Step 8: Create database session service
            session_init_start = time.time()
            logger.info(
                f"[PLAYBOOK MANAGER] Creating DatabaseSessionService for session {session_id}"
            )

            try:
                data_base_session = DatabaseSessionService(db_url=settings.DATABASE_URL)
            except Exception as e:
                error_msg = f"Failed to create database session service: {str(e)}"
                logger.error(f"[PLAYBOOK MANAGER] {error_msg}")
                raise ConnectionError(error_msg) from e

            # Step 9: Check if session exists (it should, we just created it with events)
            try:
                existing_session = await data_base_session.get_session(
                    app_name=f"{AGENT_MODE_PREFIX}{request.userId}",
                    user_id=request.userId,
                    session_id=session_id
                )
            except SQLAlchemyError as e:
                error_msg = f"Database error checking session: {str(e)}"
                logger.error(f"[PLAYBOOK MANAGER] {error_msg}")
                raise ConnectionError(error_msg) from e

            if not existing_session:
                # Session should exist, create it if not
                logger.warning(
                    f"[PLAYBOOK MANAGER] Session not found, creating new session {session_id}"
                )

                agent_name = getattr(manager_agent, 'name', "unknown")
                system_prompt = getattr(manager_agent, 'instruction', None)

                # Extract tools info
                tools_info = []
                if hasattr(manager_agent, 'tools') and manager_agent.tools:
                    for tool in manager_agent.tools:
                        tool_data = self._extract_tool_data(tool)
                        tools_info.append(tool_data)

                state = {
                    "system_prompt": system_prompt,
                    "agent_name": agent_name,
                    "tools_info": tools_info
                }

                try:
                    await data_base_session.create_session(
                        app_name=f"{AGENT_MODE_PREFIX}{request.userId}",
                        user_id=request.userId,
                        session_id=session_id,
                        state=state
                    )
                except SQLAlchemyError as e:
                    error_msg = f"Failed to create session: {str(e)}"
                    logger.error(f"[PLAYBOOK MANAGER] {error_msg}")
                    raise ConnectionError(error_msg) from e

            session_init_duration = time.time() - session_init_start
            logger.info(
                f"[PLAYBOOK MANAGER] Session initialization completed in {session_init_duration:.3f}s"
            )

            # Step 10: Create runner (same as team_orchestrator lines 499-504)
            runner_start = time.time()
            logger.info(
                f"[PLAYBOOK MANAGER] Creating Runner for session {session_id}"
            )

            try:
                agent_runner = Runner(
                    agent=manager_agent,
                    app_name=f"{AGENT_MODE_PREFIX}{request.userId}",
                    session_service=data_base_session,
                    plugins=[CleanSessionPlugin()],
                )
            except Exception as e:
                error_msg = f"Failed to create agent runner: {str(e)}"
                logger.error(f"[PLAYBOOK MANAGER] {error_msg}")
                raise RuntimeError(error_msg) from e

            runner_duration = time.time() - runner_start
            logger.info(
                f"[PLAYBOOK MANAGER] Runner created in {runner_duration:.3f}s"
            )


            # Step 12: Execute manager via streaming_processor (same as team_orchestrator line 508)
            user_prompt = request.taskDescription

            logger.info(
                f"[PLAYBOOK MANAGER] Using user prompt: {user_prompt[:100]}..."
            )

            try:
                # Execute with timeout
                manager_response = await asyncio.wait_for(
                    self.streaming_processor.process_streaming_events(
                        session_id,
                        user_prompt,
                        manager_agent,
                        agent_runner,
                        queue,
                    ),
                    timeout=MANAGER_EXECUTION_TIMEOUT
                )
            except asyncio.TimeoutError:
                error_msg = f"Manager execution timeout after {MANAGER_EXECUTION_TIMEOUT}s"
                logger.error(f"[PLAYBOOK MANAGER] {error_msg}")
                raise TimeoutError(error_msg)

            logger.info(
                f"[PLAYBOOK MANAGER] Manager execution completed - "
                f"session_id: {session_id}, "
                f"response: {manager_response[:100] if manager_response else 'No response'}..."
            )

            # Step 14: Save manager conversation to memory if enabled
            if manager_memory:
                try:
                    conversation_messages = [
                        {"role": "user", "content": user_prompt},
                        {"role": "assistant", "content": manager_response if manager_response else "Manager completed analysis"}
                    ]
                    await self.memory_service.save_manager_conversation(
                        conversation_messages,
                        request.userId
                    )
                    logger.info(
                        f"[PLAYBOOK MANAGER] Manager conversation saved to memory - session_id: {session_id}"
                    )
                except Exception as e:
                    logger.warning(
                        f"[PLAYBOOK MANAGER] Failed to save conversation to memory (non-critical): {str(e)}"
                    )

            return manager_response if manager_response else "Manager completed analysis"

        except (ValueError, ConnectionError, RuntimeError, TimeoutError) as e:
            error_msg = f"Manager execution failed: {str(e)}"
            logger.error(f"[PLAYBOOK MANAGER] {error_msg}")

            # Send error message through queue
            try:
                error_output = self.streaming_formatter.format_streaming_event(
                    agent_name="System",
                    agent_type="error",
                    chunk=f"Manager Error: {error_msg}",
                    message_id=session_id,
                    content_type="error"
                )
                await queue.put(error_output)
            except Exception as queue_error:
                logger.error(
                    f"[PLAYBOOK MANAGER] Failed to send error to queue: {str(queue_error)}"
                )

            raise RuntimeError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error re-executing manager agent: {str(e)}"
            logger.exception(f"[PLAYBOOK MANAGER] {error_msg}")

            # Send error message through queue
            try:
                error_output = self.streaming_formatter.format_streaming_event(
                    agent_name="System",
                    agent_type="error",
                    chunk=f"Manager Error: {error_msg}",
                    message_id=session_id,
                    content_type="error"
                )
                await queue.put(error_output)
            except Exception as queue_error:
                logger.error(
                    f"[PLAYBOOK MANAGER] Failed to send error to queue: {str(queue_error)}"
                )

            raise RuntimeError(error_msg) from e

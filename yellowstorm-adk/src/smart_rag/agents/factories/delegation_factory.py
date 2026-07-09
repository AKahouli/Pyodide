"""Agent delegation factory for creating and managing agent delegation functions.

This module handles the creation of delegate functions that allow the manager agent
to coordinate and assign tasks to specialized agents. It manages agent instantiation,
execution, error handling, and result processing.

Classes:
    AgentDelegationFactory: Main factory for creating agent delegation functions.
"""

import asyncio
import json
from typing import Any, Optional, List
from src.logger.logging import get_logger
from src.smart_rag.tools.utilities.tool_utils import extract_tool_names, normalize_tools
from src.smart_rag.agents.factories.delegation_factory_helper import create_agent_for_delegation, _extract_original_expected_output, _build_mcp_context_note
from src.smart_rag.agents.factories.utils import update_span_with_execution_result, process_execution_summary, \
    create_enhanced_prompt
from src.smart_rag.agents.core.helpers import AgentHelper
from src.smart_rag.engines.multi_agent.config import langfuse_client
from src.smart_rag.infrastructure.session import SessionHelper
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.messaging import StreamingFormatter
from src.smart_rag.infrastructure.memory.memory_service import MemoryService
from google.adk.sessions import InMemorySessionService, DatabaseSessionService
from src.config.settings import get_settings

logger = get_logger("api.routers.agentic_rag.AgentDelegationFactory")


class AgentDelegationFactory:
    """Creates delegation functions for agents and handles agent creation/execution.
    
    This factory class manages the complex process of creating callable delegate functions
    that the manager agent can use to assign tasks to specialized agents. It handles
    agent configuration, instantiation, execution coordination, error management,
    and result processing with full observability through Langfuse tracking.
    
    Attributes:
        config: Configuration object containing system settings and parameters.
        agent_factory: Factory for creating different types of agents.
        agent_runner: Runner for executing agent operations.
        agent_repository: Repository for managing agent configurations.
        chatbot_name (str): Default chatbot name for agent creation.
        task_search_order (int): Counter for tracking search task ordering.
        _helper: Helper instance for agent-related utility functions.
        _tool_provider: Provider for tool descriptions and requirements.
    """

    def __init__(self, config, agent_factory, agent_runner, agent_repository,agent_helper,tool_description_provider,citation_manager):
        """Initialize the agent delegation factory.

        Args:
            config: Configuration object containing system settings, user ID, and defaults.
            agent_factory: Factory instance for creating different types of agents.
            agent_runner: Runner instance for executing agent operations and agentic_workflows.
            agent_repository: Repository for storing and retrieving agent configurations.
            agent_helper: Helper instance for agent name normalization and utilities.
            tool_description_provider: Provider for tool descriptions and formatting.
        """
        self.config = config
        self.agent_factory = agent_factory
        self.agent_runner = agent_runner
        self.agent_repository = agent_repository
        self.chatbot_name = config.chatbot_name if hasattr(config, 'chatbot_name') else 'default'

        # Shared task search order counter for all agents with search tools
        self.task_search_order = 0

        self._helper = agent_helper
        self._tool_provider = tool_description_provider
        self._memory_service: Optional[MemoryService] = None
        self._image_input: Optional[List] = None
        self.citation_manager=citation_manager

    def set_image_input(self, image_input: Optional[List] = None) -> None:
        """Set the image input for agent delegation.

        Stores the image input so delegate functions can pass images
        to subagents when the manager decides it's necessary.

        Args:
            image_input: List of image dicts like [{"image 1": "data:image/jpeg;base64,..."}, ...]
        """
        self._image_input = image_input

    def set_memory_service(self, memory_service: MemoryService) -> None:
        """Set the memory service for agent delegation.

        Args:
            memory_service: Initialized memory service instance
        """
        self._memory_service = memory_service


    def make_delegate_function(self, agent_name: str, q: Optional[asyncio.Queue[dict]] = None,
                               search_web: Optional[bool] = False, parent_span=None) -> Any:
        """Create a delegate function for the agent.
        
        Creates a callable async function that the manager agent can use to delegate
        tasks to the specified specialized agent. The function handles agent creation,
        execution, error management, and result processing with full observability.
        
        Args:
            agent_name (str): Name of the agent to create delegation function for.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses to client.
            search_web (Optional[bool]): Whether the agent should have web search capabilities.
            parent_span: Langfuse span for tracking delegation operations hierarchy.
            
        Returns:
            Any: Callable async function that accepts task_description and expected_output
                parameters and returns the agent's execution result.
        """
        normalized_agent_name = self._helper.normalize_agent_name(agent_name)
        agent_config = self.agent_repository.get_agent_by_name(normalized_agent_name)

        # Get agent description for the function
        agent_description = agent_config.get('description',
                                             'No description available') if agent_config else 'Agent not found'

        async def delegate(task_description: str, expected_output: str, delegate_images: bool = False):
            # Extract and clean original_expected_output from task_description
            task_description, original_expected_output = _extract_original_expected_output(task_description)

            logger.info(f"[DELEGATION] Starting delegation to agent: {agent_name} - session_id: {self.config.session_id}")
            logger.info(f"[DELEGATION] Original expected output: {original_expected_output}")

            # Resolve image_input based on delegate_images flag
            resolved_image_input = self._image_input if delegate_images and self._image_input else None

            # Create span for agent delegation
            delegation_span = langfuse_client.span(
                trace_id=self.config.session_id,
                parent_span_id=parent_span.span_id if parent_span else None,
                name=f"delegate_to_{normalized_agent_name}",
                input={
                    "agent_name": agent_name,
                    "task_description": task_description,
                    "task_order": expected_output,
                    "tools": agent_config.get('tools', []) if agent_config else [],
                    "search_depth": "standard" if "search_web" in (agent_config.get('tools', []) or []) else "UNDEFINED",
                    "delegate_images": delegate_images,
                    "has_images": bool(resolved_image_input)
                },
            )

            # Create agent with error handling
            agent, toolkit = await self._create_agent_with_error_handling(
                agent_config, agent_name, normalized_agent_name, expected_output, delegation_span, search_web,self.citation_manager
            )
            if agent is None:
                logger.error(f"[DELEGATION] Failed to create agent: {agent_name} - session_id: {self.config.session_id}")
                return None

            # Execute agent with error handling
            agent_id = self.agent_repository.get_agent_id_by_name(agent_name)
            result = await self._execute_agent_with_error_handling(
                agent,agent_config, task_description, original_expected_output, expected_output, delegation_span, q, agent_name, agent_id, toolkit,
                image_input=resolved_image_input
            )

            if result:
                logger.info(f"[DELEGATION] Successfully completed delegation to agent: {agent_name} - session_id: {self.config.session_id}")
            else:
                logger.warning(f"[DELEGATION] Delegation returned no result for agent: {agent_name} - session_id: {self.config.session_id}")

            return result

        # Set the function's docstring to include agent description and parallel execution hint
        delegate.__doc__ = self._build_delegate_doc(agent_name, agent_description)

        return delegate

    async def _create_agent_with_error_handling(self, agent_config, agent_name, normalized_agent_name, expected_output,
                                                delegation_span, search_web: Optional[bool] = False,citation_manager=None) -> Optional[Any]:
        """Create agent with proper error handling and span updates.
        
        Handles the complete agent creation process including configuration validation,
        tool assignment, prompt enhancement, and agent instantiation with comprehensive
        error handling and observability tracking.
        
        Args:
            agent_config: Dictionary containing agent configuration and metadata.
            agent_name (str): Original name of the agent to create.
            normalized_agent_name (str): Normalized version of the agent name.
            expected_output (str): Expected output format for the agent.
            delegation_span: Langfuse span for tracking the delegation operation.
            search_web (Optional[bool]): Whether to enable web search capabilities.
            
        Returns:
            Optional[Any]: Tuple of (agent, toolkit) if successful, None if creation fails.
        """
        try:
            if not agent_config:
                error_msg = f"Agent {agent_name} not found"
                logger.exception(error_msg)
                delegation_span.update(output={
                    "result": None,
                    "execution_status": "failed",
                    "error": error_msg
                })
                return None, None

            tools = agent_config.get('tools')
            if tools is None:
                tools = []
            # Ensure tools is always a list to prevent NoneType iteration error
            if not isinstance(tools, list):
                tools = []

            # Normalize tools to lowercase at entry point (handles both strings and dicts)
            tools = normalize_tools(tools)
            # Update agent_config with normalized tools
            agent_config['tools'] = tools

            # Extract tool names from flexible format (handles both strings and dicts)
            tool_names = extract_tool_names(tools)
            base_enhanced_prompt = create_enhanced_prompt(self._tool_provider, self.agent_repository, agent_config, tool_names, tools)

            # Add agent memory context to the prompt if memory service is available and save_memory is enabled
            if agent_config.get('save_memory', False):
                base_enhanced_prompt = await self._add_memory_context_to_prompt(
                    base_enhanced_prompt, agent_name, normalized_agent_name, expected_output
                )

            # Add attached images context to the agent prompt
            attached_images = getattr(self.config, 'attached_images', None)
            if attached_images:
                image_names = [img.get("filename", "Unknown") for img in attached_images]
                base_enhanced_prompt += (
                    "\n\n<attached_images>\n"
                    "The user attached the following images:\n"
                    + json.dumps(image_names, ensure_ascii=False) + "\n"
                    "\nInstructions:\n"
                    "- The images are included in your context if delegate_images was set to True.\n"
                    "- Use the image contents when relevant to the task.\n"
                    "</attached_images>"
                )

            mcp_note = _build_mcp_context_note(self.config, agent_config)
            if mcp_note:
                base_enhanced_prompt = f"{base_enhanced_prompt}\n\n{mcp_note}"

            agent, toolkit = create_agent_for_delegation(self._helper,self._tool_provider,self.agent_factory,self.config,
                agent_config, tool_names, base_enhanced_prompt, expected_output, normalized_agent_name,self.chatbot_name, search_web,
                citation_manager=self.citation_manager
            )

            delegation_span.update(
                output={
                    "agent_type": "html" if agent_config.get('html', False) else "regular",
                    "tools_available": tool_names,  # Use extracted tool names for logging
                    "prompt_length": len(base_enhanced_prompt)
                },
            )

            return agent, toolkit

        except Exception as e:
            error_msg = f"Error creating {agent_name}: {str(e)}"
            logger.exception(error_msg)
            delegation_span.event(
                name="error",
                output={
                    "error_message": str(e),
                    "error_type": "agent_creation_error"
                },
            )
            delegation_span.update(output={
                "result": None,
                "execution_status": "failed",
                "error": str(e)
            })
            return None, None

    async def _execute_agent_with_error_handling(self, agent,agent_config, task_description, expected_output, task_order, delegation_span, q,
                                                 agent_name, agent_id="no_id", toolkit=None,
                                                 image_input: Optional[List] = None) -> Optional[Any]:
        """Execute agent with proper error handling and span updates.

        Manages the complete agent execution process including session management,
        task execution, result processing, and comprehensive error handling with
        full observability and tracking.

        Args:
            agent: The agent instance to execute.
            task_description (str): Description of the task for the agent to perform.
            expected_output (str): Expected format or type of output.
            delegation_span: Langfuse span for tracking execution metrics.
            q: Queue for streaming responses to client.
            agent_name (str): Name of the agent being executed.
            agent_id (str): Unique identifier for the agent, defaults to "no_id".
            toolkit: Optional toolkit associated with the agent.
            image_input (Optional[List]): List of image dicts to pass to the agent when delegate_images is True.

        Returns:
            Optional[Any]: Agent execution result if successful, None if execution fails.
        """
        logger.info(f"[DELEGATION] Starting execution for agent: {agent_name} - session_id: {self.config.session_id}")
        logger.debug(f"[DELEGATION] Agent {agent_name} config: {agent_config}")
        logger.debug(f"[DELEGATION] Agent {agent_name} task_description: {task_description[:200]}...")
        logger.debug(f"[DELEGATION] Agent {agent_name} expected_output: {expected_output}")

        try:
            logger.info(f"[DELEGATION] Creating session helper for agent: {agent_name}")

            session_helper = InMemorySessionService()
            seed_events = []
            try:
                shared = DatabaseSessionService(db_url=get_settings().DATABASE_URL)
                shared_session = await shared.get_session(
                    app_name="manager_app", user_id=self.config.user_id, session_id=self.config.session_id
                )
                if shared_session and shared_session.events:
                    seed_events = list(shared_session.events)
            except OSError as e:
                logger.warning(
                    f"[DELEGATION] Could not load shared conversation for {agent_name}, running without history - error={e}"
                )
            logger.debug(f"[DELEGATION] Session helper created: {type(session_helper)}, seeded_events={len(seed_events)}")

            toolkit = getattr(agent, '_toolkit', toolkit)
            logger.debug(f"[DELEGATION] Agent {agent_name} toolkit: {type(toolkit) if toolkit else None}")

            # Retrieve call_id from registry if available
            call_id_info = None
            if hasattr(self.config, 'call_id_registry') and agent_name in self.config.call_id_registry:
                call_id_info = self.config.call_id_registry.pop(agent_name)
                logger.info(f"[DELEGATION] Retrieved call_id from registry for agent: {agent_name}, call_id: {call_id_info.get('call_id')}")

            logger.info(f"[DELEGATION] Calling run_agent_tool for agent: {agent_name}, with_images: {bool(image_input)}")
            result, mcp_used, execution_summary, generated_files = await self.agent_runner.run_agent_tool(
                agent=agent,
                message=task_description,
                session_helper=session_helper,
                user_id=self.config.user_id,
                q=q,
                task_order=task_order,
                agent_id=agent_id,
                toolkit=toolkit,
                agent_config=agent_config,
                expected_output=expected_output,
                function_call_id_info=call_id_info,
                image_input=image_input,
                session_id=self.config.session_id,
                seed_events=seed_events,
            )

            logger.info(f"[DELEGATION] run_agent_tool completed for agent: {agent_name}")
            logger.debug(f"[DELEGATION] Agent {agent_name} result type: {type(result)}")
            logger.debug(f"[DELEGATION] Agent {agent_name} result is None: {result is None}")
            logger.debug(f"[DELEGATION] Agent {agent_name} result length: {len(result) if result else 0}")
            logger.debug(f"[DELEGATION] Agent {agent_name} mcp_used: {mcp_used}")
            logger.debug(f"[DELEGATION] Agent {agent_name} execution_summary: {execution_summary}")

            # Check if result is None or empty
            if result is None:
                logger.warning(f"[DELEGATION] Result is None for agent: {agent_name} - session_id: {self.config.session_id}")
            elif isinstance(result, str):
                if not result.strip():
                    logger.warning(f"[DELEGATION] Result is empty string for agent: {agent_name} - session_id: {self.config.session_id}")
                else:
                    logger.debug(f"[DELEGATION] Result preview for agent {agent_name}: {result[:100]}...")
            elif hasattr(result, '__len__') and len(result) == 0:
                logger.warning(f"[DELEGATION] Result is empty collection for agent: {agent_name} - session_id: {self.config.session_id}")

            # Handle python_interpreter generated files only if python_interpreter was actually used
            if mcp_used and 'python_interpreter' in mcp_used:
                await self._handle_python_interpreter_files(agent_name, mcp_used, q, generated_files)

            # Process execution summary if available
            if execution_summary:
                logger.debug(f"[DELEGATION] Processing execution summary for agent: {agent_name}")
                process_execution_summary(execution_summary, delegation_span)
            else:
                logger.warning(f"[DELEGATION] No execution summary for agent: {agent_name}")

            # Update span based on execution success
            logger.debug(f"[DELEGATION] Updating span for agent: {agent_name}")
            update_span_with_execution_result(delegation_span, result, execution_summary, agent_name)

            # Save agent conversation to memory if result is available and save_memory is enabled
            if agent_config.get('save_memory', False):
                logger.debug(f"[DELEGATION] Saving conversation to memory for agent: {agent_name}")
                await self._save_agent_conversation_to_memory(result, agent_id, agent_name, task_description)

            logger.info(f"[DELEGATION] Successfully completed execution for agent: {agent_name} - session_id: {self.config.session_id}")
            return result

        except Exception as e:
            error_msg = f"Error running {agent_name}: {str(e)}"
            logger.exception(f"[DELEGATION] {error_msg} - session_id: {self.config.session_id}")
            logger.error(f"[DELEGATION] Exception type: {type(e).__name__}")
            logger.error(f"[DELEGATION] Exception args: {e.args}")
            delegation_span.event(
                name="error",
                output={
                    "error_message": str(e),
                    "error_type": "agent_execution_error"
                },
            )
            delegation_span.update(output={
                "result": None,
                "execution_status": "failed",
                "error": str(e)
            })
            return None

    async def _add_memory_context_to_prompt(self, base_prompt: str, agent_name: str,
                                          normalized_agent_name: str, expected_output: str) -> str:
        """Add memory context to agent prompt if available.

        Args:
            base_prompt: Base enhanced prompt
            agent_name: Original agent name
            normalized_agent_name: Normalized agent name
            expected_output: Expected output from agent

        Returns:
            Enhanced prompt with memory context
        """
        if not self._memory_service:
            return base_prompt

        try:
            agent_id = self.agent_repository.get_agent_id_by_name(agent_name) or normalized_agent_name
            if hasattr(self._memory_service, 'memory') and self._memory_service.memory:
                memory_context = await self._memory_service.create_agent_context(expected_output, agent_id)
                if memory_context:
                    return base_prompt + "\n- Tu dois toujours suivre les instructions et les spécifications suivantes:\n" + memory_context
        except Exception as e:
            logger.warning(f"Failed to add memory context for agent {agent_name}: {str(e)}")

        return base_prompt

    async def _save_agent_conversation_to_memory(self, result: Any, agent_id: str,
                                               agent_name: str, task_description: str) -> None:
        """Save agent conversation to memory if conditions are met.

        Args:
            result: Agent execution result
            agent_id: Agent identifier
            agent_name: Agent name for logging
            task_description: Description of the task performed
        """
        if not result or not agent_id or agent_id == "no_id" or not self._memory_service:
            return

        try:
            conversation_messages = [
                {"role": "user", "content": task_description},
                {"role": "assistant", "content": str(result)}
            ]
            await self._memory_service.save_agent_conversation(
                conversation_messages, agent_id
            )
        except Exception as e:
            logger.warning(f"Failed to save conversation for agent {agent_name}: {str(e)}")

    _DELEGATE_IMAGES_DOC = """
    delegate_images (bool): IMPORTANT - Controls whether the user's uploaded images are forwarded to this agent.
        You MUST evaluate this based on the agent's role AND the task context:
        - Set to True when the task description involves analyzing, describing, comparing, extracting information from, or referencing visual content (charts, diagrams, screenshots, photos, documents, tables, UI mockups, etc.).
        - Set to True when the agent's purpose (based on its name and description) is related to visual analysis, data extraction, document understanding, image processing, or any domain where images provide useful context.
        - Set to True when the user's original request explicitly mentions or references images and the delegated task is related to that request.
        - Set to True when in doubt and the task COULD benefit from visual context — it is always better to provide images unnecessarily than to omit them when needed.
        - Set to False ONLY when the task is purely text-based with absolutely no relation to visual content (e.g., pure text generation, code writing without UI reference, mathematical calculations without visual input).
        Defaults to False."""

    def _build_delegate_doc(self, agent_name: str, agent_description: str) -> str:
        """Build the delegate function docstring with image delegation docs."""
        base_doc = f"""Delegate task to {agent_name}: {agent_description}
Args:
    task_description (str): Description of the task to be performed by the agent
    expected_output (str): Expected format or type of output from the agent"""

        return base_doc + self._DELEGATE_IMAGES_DOC + """

Returns:
    The result from the specialized agent
"""

    async def _handle_python_interpreter_files(self, agent_name: str, mcp_used: List[str],
                                               q: Optional[asyncio.Queue[dict]],
                                               generated_files: list = None) -> None:
        """Handle file uploads from python_interpreter tool after agent execution.

        Args:
            agent_name: Name of the agent that executed
            mcp_used: List of tools that were used during execution
            q: Queue for streaming file metadata to client
            generated_files: List of generated files extracted from session state by runner
        """
        if not mcp_used or 'python_interpreter' not in mcp_used:
            return

        if not q:
            return

        try:
            if not generated_files:
                return

            session_id = self.config.session_id
            files_count = len(generated_files)
            logger.info(f"[DELEGATION] python_interpreter used by {agent_name}: {files_count} files generated - session_id: {session_id}")

            streaming_formatter = StreamingFormatter()
            logger.info(f"[DELEGATION] Sending {files_count} python_interpreter files to backend - agent_name: {agent_name}, session_id: {session_id}")

            for file in generated_files:
                upload_output = streaming_formatter.format_streaming_event(
                    agent_name=agent_name,
                    agent_type="agent",
                    chunk=json.dumps(file),
                    message_id=session_id,
                    content_type="File"
                )
                await q.put(upload_output)

        except Exception as e:
            logger.exception(f"python_interpreter file retrieval failed for {agent_name}: {str(e)}")


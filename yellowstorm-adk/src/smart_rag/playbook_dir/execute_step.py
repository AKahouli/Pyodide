"""Module for re-executing playbook steps with modified descriptions."""

import asyncio
import uuid
from typing import Optional, List, Dict, Any
from google.genai import types
from google.adk.agents.run_config import StreamingMode, RunConfig
from google.adk import Agent
from sqlalchemy.exc import SQLAlchemyError

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.schema.playbook import RunPlaybookStepRequest
from src.smart_rag.agents.factories import AgentFactory
from src.smart_rag.agents.factories.delegation_factory import AgentDelegationFactory
from src.smart_rag.agents.core.runner import AgentRunner
from src.smart_rag.agents.core.helpers import AgentHelper
from src.smart_rag.agents.core.repository import AgentRepository
from src.smart_rag.tools.infrastructure.tool_descriptions import ToolDescriptionProvider
from google.adk.sessions import DatabaseSessionService
from src.smart_rag.infrastructure.processing import PromptProcessor
from src.smart_rag.infrastructure.factories import LLMFactory
from src.smart_rag.messaging import StreamingFormatter, MessageTransformer
from src.smart_rag.engines.traditional import EventExtractor
from src.smart_rag.engines.multi_agent.config import langfuse_client, AgentTeamConfig
from src.smart_rag.playbook_dir.execute_manager import PlaybookManagerExecutor
from src.smart_rag.infrastructure.session.citation_manager import (
    clone_citation_manager_state,
    get_citation_manager,
)

# Constants
DEFAULT_MODEL = 'gpt-5.4-mini'
DEFAULT_TEMPERATURE = 0.7
DEFAULT_TOP_K = 3
MAX_LLM_CALLS = 50
LOG_INTERVAL = 10  # Log every N events during injection
SESSION_PREFIX = "session-"
TEMP_SESSION_PREFIX = "temp-execution-"
AGENT_MODE_PREFIX = "Agent_mode_"

logger = get_logger("api.smart_rag.playbook_dir.execute_step")
settings = get_settings()


class PlaybookStepExecutor:
    """Service for re-executing playbook steps with modified descriptions."""

    def __init__(self):
        """Initialize the PlaybookStepExecutor."""
        self.prompt_processor = PromptProcessor()
        self.llm_factory = LLMFactory()
        self.agent_factory = AgentFactory(self.prompt_processor, self.llm_factory)
        self.streaming_formatter = StreamingFormatter()
        self.run_config = RunConfig(streaming_mode=StreamingMode.SSE, max_llm_calls=MAX_LLM_CALLS)

        # Initialize components needed for AgentDelegationFactory
        self.agent_helper = AgentHelper()
        self.agent_repository = AgentRepository(self.agent_helper)
        self.tool_description_provider = ToolDescriptionProvider()
        self.event_extractor = EventExtractor()
        self.message_transformer = MessageTransformer()

        # Initialize AgentRunner
        self.agent_runner = AgentRunner(
            event_extractor=self.event_extractor,
            message_transformer=self.message_transformer,
            streaming_formatter=self.streaming_formatter,
            prompt_processor=self.prompt_processor
        )

        # Note: AgentDelegationFactory will be created per request with specific config
        self.delegation_factory = None

    def _check_search_web_tool(self, request: RunPlaybookStepRequest) -> bool:
        """Check if search_web tool is present in agent tools.

        Args:
            request: The playbook step request containing agent configuration

        Returns:
            bool: True if search_web tool is present, False otherwise
        """
        try:
            agent_config = request.agent
            if not agent_config or not agent_config.tools:
                return False

            for tool in agent_config.tools:
                tool_name = tool.lower() if isinstance(tool, str) else str(tool).lower()
                if "search_web" in tool_name:
                    logger.info(f"[PLAYBOOK EXECUTOR] search_web tool detected in agent tools")
                    return True

            return False
        except (AttributeError, TypeError) as e:
            logger.warning(f"[PLAYBOOK EXECUTOR] Invalid tool configuration: {str(e)}")
            return False
        except Exception as e:
            logger.error(f"[PLAYBOOK EXECUTOR] Unexpected error checking search_web tool: {str(e)}")
            return False

    @staticmethod
    def _extract_document_id(doc: dict) -> Optional[str]:
        """Extract document ID from document dictionary.

        Args:
            doc: Document dictionary

        Returns:
            Document ID if found, None otherwise
        """
        return doc.get('id') or doc.get('_id') or doc.get('document_id')

    def _merge_documents_without_duplicates(self, base_documents: List, agent_documents: List) -> List:
        """Merge agent documents with base documents, avoiding duplicates.

        This follows the same logic as team_orchestrator.py for consistency.

        Args:
            base_documents: Base/config documents
            agent_documents: Agent-specific documents

        Returns:
            Merged list of documents without duplicates based on document ID
        """
        existing_doc_ids = {
            self._extract_document_id(doc)
            for doc in base_documents
            if isinstance(doc, dict) and self._extract_document_id(doc) is not None
        }

        result_documents = list(base_documents)

        for doc in agent_documents:
            doc_id = self._extract_document_id(doc) if isinstance(doc, dict) else None

            if doc_id is None or doc_id not in existing_doc_ids:
                result_documents.append(doc)
                if doc_id:
                    existing_doc_ids.add(doc_id)

        return result_documents

    def _create_config_object(self, request: RunPlaybookStepRequest, session_id: str):
        """Create a config object for AgentDelegationFactory.

        Args:
            request: The playbook step request
            session_id: The session ID to use

        Returns:
            A simple config object with required attributes
        """
        class SimpleConfig:
            def __init__(self, session_id, user_id, chatbot_name, brain_ids, vectorstore_name):
                self.session_id = session_id
                self.user_id = user_id
                self.chatbot_name = chatbot_name
                self.brain_ids = brain_ids
                self.vectorstore_name = vectorstore_name

        # Extract chatbot_name from agent config
        chatbot_name = request.agent.chatbot_name
        if isinstance(chatbot_name, dict):
            chatbot_name = chatbot_name.get('provider', chatbot_name.get('name', DEFAULT_MODEL))
        elif not chatbot_name:
            # Fallback to a default model if chatbot_name is not provided
            chatbot_name = DEFAULT_MODEL

        return SimpleConfig(
            session_id=session_id,
            user_id=request.userId,
            chatbot_name=chatbot_name,
            brain_ids=request.agent.brain_ids,
            vectorstore_name=request.vectorstore_name
        )

    def _index_available_tools(self, available_tools: list[dict]) -> dict:
        """
        Index available tools by their name for fast lookup.

        This allows matching agent tools (which use 'name') against the full
        tool definitions from available_tools (which have both '_id' and 'name').

        Args:
            available_tools: List of tool definitions from backend

        Returns:
            Dict mapping tool names to full tool definitions
        """
        return {
            tool["name"]: tool
            for tool in available_tools
            if "name" in tool
        }

    def _convert_request_to_agent_config(self, request: RunPlaybookStepRequest) -> Dict[str, Any]:
        """Convert RunPlaybookStepRequest to agent_config dict for AgentDelegationFactory.

        Matches agent tools against available_tools to build complete tool definitions
        with all necessary attributes (name, prompt, top_k, etc.).

        Args:
            request: The playbook step request containing agent config and available_tools

        Returns:
            Agent configuration dictionary with properly formatted tools
        """
        try:
            agent_config = request.agent
            available_tools = request.available_tools or []
            available_tools_by_name = self._index_available_tools(available_tools)

            # Convert tools to the expected format by matching with available_tools
            tools = []
            if agent_config.tools:
                for agent_tool in agent_config.tools:
                    # 1️⃣ Extract tool name from agent tool (handles both dict and string formats)
                    tool_name = None
                    if isinstance(agent_tool, dict):
                        tool_name = agent_tool.get("name")
                    elif isinstance(agent_tool, str):
                        tool_name = agent_tool

                    if not tool_name:
                        logger.warning(f"[PLAYBOOK EXECUTOR] Skipping tool without name: {agent_tool}")
                        continue

                    # 2️⃣ Match against available_tools to get full tool definition
                    tool_def = available_tools_by_name.get(tool_name)
                    if not tool_def:
                        logger.warning(f"[PLAYBOOK EXECUTOR] Tool '{tool_name}' not found in available_tools, skipping")
                        continue

                    # 3️⃣ Build complete tool payload with name
                    tool_payload = {
                        "name": tool_def["name"]
                    }

                    # 4️⃣ Inject attributes (prompt, top_k, etc.) from tool definition
                    for attr in tool_def.get("attributes", []):
                        attr_name = attr.get("name")
                        attr_value = attr.get("value")
                        if attr_name and attr_value is not None:
                            tool_payload[attr_name] = attr_value

                    tools.append(tool_payload)
                    logger.info(f"[PLAYBOOK EXECUTOR] Added tool '{tool_payload['name']}' with attributes: {list(tool_payload.keys())}")

            # Extract chatbot_name (LLM model name)
            chatbot_name_dict = agent_config.chatbot_name
            if isinstance(chatbot_name_dict, dict):
                # Keep as dict for consistency with delegation_factory
                chatbot_name = chatbot_name_dict
            elif chatbot_name_dict:
                # Convert string to dict
                chatbot_name = {'name': chatbot_name_dict, 'provider': chatbot_name_dict}
            else:
                # Fallback to default model
                chatbot_name = {'name': DEFAULT_MODEL, 'provider': DEFAULT_MODEL}

            # Get brain documents and relations from agent config
            # These should have been merged in execute_step() before calling this method
            brain_documents = agent_config.brain_documents if agent_config.brain_documents else []
            brain_relations = agent_config.brain_relations if agent_config.brain_relations else {'nodes': [], 'relationships': []}

            # Extract agent_params with proper defaults
            temperature = DEFAULT_TEMPERATURE
            if agent_config.agent_params:
                temperature = agent_config.agent_params.get('temperature', DEFAULT_TEMPERATURE)

            logger.info(f"[PLAYBOOK EXECUTOR] Converted agent config with {len(tools)} tools for agent '{agent_config.name}'")

            # Build agent_config matching delegation_factory structure
            # Pass full agent_params to preserve connector_bindings_json, max_tokens, etc.
            full_agent_params = dict(agent_config.agent_params) if agent_config.agent_params else {}
            full_agent_params.setdefault('temperature', temperature)

            return {
                'id': agent_config.id,
                'name': agent_config.name,
                'description': agent_config.description,
                'prompt': agent_config.prompt,
                'tools': tools,
                'html': agent_config.html,
                'vectorstore_name': request.vectorstore_name,
                'brain_ids': agent_config.brain_ids,
                'brain_documents': brain_documents,
                'brain_relations': brain_relations,
                'chatbot_name': chatbot_name,
                'agent_params': full_agent_params,
                'agent_type': agent_config.agent_type if hasattr(agent_config, 'agent_type') and agent_config.agent_type else 'normal',
                'save_memory': agent_config.save_memory,
                'mcp': agent_config.mcp if hasattr(agent_config, 'mcp') else None,
                # Store originals for reference (used by delegation_factory)
                '_original_brain_documents': brain_documents,
                '_original_brain_relations': brain_relations,
            }
        except Exception as e:
            logger.error(f"[PLAYBOOK EXECUTOR] Error in _convert_request_to_agent_config: {e}")
            raise

    def _filter_events_up_to_call_id(
        self,
        events: List[Any],
        target_call_id: str
    ) -> List[Any]:
        """Keep only events up to and including the target call_id.

        This removes all manager events that come after the re-executed step,
        so the manager can be re-executed with the updated context.

        Args:
            events: List of events
            target_call_id: The call_id of the step

        Returns:
            Filtered list of events (up to and including the target step)
        """
        last_target_index = -1

        try:
            # Find the last event with the target_call_id
            for idx, event in enumerate(events):
                if not event.content or not event.content.parts:
                    continue

                for part in event.content.parts:
                    if hasattr(part, 'function_call') and part.function_call:
                        if hasattr(part.function_call, 'id') and part.function_call.id == target_call_id:
                            last_target_index = idx

                    elif hasattr(part, 'function_response') and part.function_response:
                        if hasattr(part.function_response, 'id') and part.function_response.id == target_call_id:
                            last_target_index = idx

            if last_target_index == -1:
                logger.warning(
                    f"[PLAYBOOK EXECUTOR] Could not find target_call_id {target_call_id}"
                )
                return events

            logger.info(
                f"[PLAYBOOK EXECUTOR] Filtering events: keeping {last_target_index + 1} events "
                f"out of {len(events)} (removing {len(events) - last_target_index - 1} events after step)"
            )

            # Return events up to and including the target
            return events[:last_target_index + 1]

        except Exception as e:
            logger.exception(
                f"[PLAYBOOK EXECUTOR] Error filtering events: {str(e)}"
            )
            return events

    def _extract_expected_output_from_events(
        self,
        events: List[Any],
        call_id: str
    ) -> Optional[str]:
        """Extract expected_output from copied events using call_id.

        Searches through events to find a function_call with matching id,
        then extracts the expected_output from its args.

        Args:
            events: List of events to search through
            call_id: The function_call.id to match

        Returns:
            expected_output string if found, None otherwise
        """
        try:
            for event in events:
                if not event.content or not event.content.parts:
                    continue

                for part in event.content.parts:
                    if hasattr(part, 'function_call') and part.function_call:
                        if hasattr(part.function_call, 'id') and part.function_call.id == call_id:
                            # Found matching function_call
                            if hasattr(part.function_call, 'args') and part.function_call.args:
                                expected_output = part.function_call.args.get('expected_output')
                                if expected_output:
                                    logger.info(
                                        f"[PLAYBOOK EXECUTOR] Found expected_output for call_id {call_id}: "
                                        f"{expected_output[:100] if len(expected_output) > 100 else expected_output}..."
                                    )
                                    return expected_output

            logger.warning(
                f"[PLAYBOOK EXECUTOR] No expected_output found for call_id: {call_id}"
            )
            return None

        except Exception as e:
            logger.exception(
                f"[PLAYBOOK EXECUTOR] Error extracting expected_output from events: {str(e)}"
            )
            return None

    async def execute_step_only(
        self,
        request: RunPlaybookStepRequest,
        queue: asyncio.Queue[dict],
        copied_events: Optional[List[Any]] = None,
        citation_session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Execute only the step (without manager re-execution).

        This is used internally by execute_step to re-execute just the step.

        Args:
            request: The playbook step execution request
            queue: Queue for streaming responses
            copied_events: Optional list of copied events to extract expected_output from

        Returns:
            Dict containing step execution results
        """
        temp_session_id = f"temp-execution-{uuid.uuid4()}"

        try:
            citation_manager = None
            if citation_session_id:
                citation_manager = await get_citation_manager(citation_session_id)

            # Create agent and execute with new description
            # Create config object for delegation factory
            config_obj = self._create_config_object(request, temp_session_id)

            # Create AgentDelegationFactory instance
            delegation_factory = AgentDelegationFactory(
                config=config_obj,
                agent_factory=self.agent_factory,
                agent_runner=self.agent_runner,
                agent_repository=self.agent_repository,
                agent_helper=self.agent_helper,
                tool_description_provider=self.tool_description_provider,
                citation_manager=citation_manager
            )

            # Convert request to agent_config
            agent_config = self._convert_request_to_agent_config(request)
            normalized_agent_name = self.agent_helper.normalize_agent_name(request.agent.name)

            # Extract expected_output from copied_events if available
            expected_output = None
            if copied_events and request.call_id:
                expected_output = self._extract_expected_output_from_events(
                    events=copied_events,
                    call_id=request.call_id
                )

            # Fallback to order if expected_output not found
            if not expected_output:
                expected_output = str(request.order)
                logger.info(
                    f"[PLAYBOOK EXECUTOR] Using fallback expected_output: {expected_output}"
                )

            # Check if search_web tool is present
            search_web = self._check_search_web_tool(request)

            # Create span for agent delegation (Langfuse tracking)
            delegation_span = langfuse_client.span(
                trace_id=temp_session_id,
                name=f"playbook_step_replay_{request.agent.name}",
                input={
                    "agent_name": request.agent.name,
                    "task_description": request.taskDescription,
                    "task_id": request.taskId,
                    "task_order": str(request.order),
                    "call_id": request.call_id,
                    "tools": agent_config.get('tools', []) if agent_config else [],
                    "search_web": search_web
                },
            )

            # Use delegation_factory to create agent with error handling
            agent, toolkit = await delegation_factory._create_agent_with_error_handling(
                agent_config=agent_config,
                agent_name=request.agent.name,
                normalized_agent_name=normalized_agent_name,
                expected_output=expected_output,
                delegation_span=delegation_span,
                search_web=search_web
            )

            if not agent:
                error_msg = f"Failed to create agent: {request.agent.name}"
                logger.error(f"[PLAYBOOK EXECUTOR] {error_msg}")
                return {
                    "success": False,
                    "agent": None,
                    "error": error_msg
                }

            # Use delegation_factory to execute agent with error handling
            new_result = await delegation_factory._execute_agent_with_error_handling(
                agent=agent,
                agent_config=agent_config,
                task_description=request.taskDescription,
                expected_output=expected_output,
                task_order=str(request.order),
                delegation_span=delegation_span,
                q=queue,
                agent_name=request.agent.name,
                agent_id=request.agent.name,
                toolkit=toolkit
            )

            if not new_result:
                error_msg = "Agent execution returned no result"
                logger.error(f"[PLAYBOOK EXECUTOR] {error_msg}")
                return {
                    "success": False,
                    "agent": agent,
                    "error": error_msg
                }

            logger.info(
                f"[PLAYBOOK EXECUTOR] Step execution completed, got new result: {new_result[:100]}..."
            )

            return {
                "success": True,
                "agent": agent,
                "result": new_result
            }

        except Exception as e:
            error_msg = f"Error executing step: {str(e)}"
            logger.exception(f"[PLAYBOOK EXECUTOR] {error_msg}")
            return {
                "success": False,
                "agent": None,
                "error": error_msg
            }

    async def execute_step(
        self,
        request: RunPlaybookStepRequest,
        queue: asyncio.Queue[dict]
    ) -> Dict[str, Any]:
        """Re-execute a playbook step and manager with new description.

        This function orchestrates the complete re-execution flow:
        1. Retrieves ALL events from the original session
        2. Creates a copy of all events
        3. Executes the step with new description to get new result
        4. Modifies the step events with new data
        5. Filters out manager events after the step
        6. Reinjects filtered events into a new session
        7. Re-executes the manager agent with updated context

        Args:
            request: The playbook step execution request containing:
                - messageId: Original session ID to retrieve all events from
                - call_id: Identifier to find specific step events to replace
                - taskId: ID of the task/step to re-execute
                - taskDescription: New description for the step
                - order: Order number of the step in the playbook
                - agent: Complete agent configuration for the step
                - manager_agent: Manager agent configuration
            queue: AsyncIO queue for streaming response events back to client

        Returns:
            Dict containing execution results with keys:
                - success: bool
                - new_session_id: str
                - result: str (manager's final response)
                - step_result: str (step's result)
                - error: Optional[str]
        """
        # Merge brain_ids, brain_documents from request with agent and manager
        # Following the same logic as run_agent_team_endpoint (team_orchestrator.py)

        # Get config-level brain_ids and brain_documents from request
        config_brain_ids = request.brain_ids or []
        config_brain_documents = request.brain_documents or []

        # Merge brain_ids for agent (config brain_ids + agent brain_ids, no duplicates)
        agent_brain_ids = request.agent.brain_ids or []
        merged_agent_brain_ids = list(config_brain_ids)
        for brain_id in agent_brain_ids:
            if brain_id not in merged_agent_brain_ids:
                merged_agent_brain_ids.append(brain_id)
        request.agent.brain_ids = merged_agent_brain_ids

        # Merge brain_ids for manager (config brain_ids + manager brain_ids, no duplicates)
        manager_brain_ids = request.manager_agent.brain_ids or []
        merged_manager_brain_ids = list(config_brain_ids)
        for brain_id in manager_brain_ids:
            if brain_id not in merged_manager_brain_ids:
                merged_manager_brain_ids.append(brain_id)
        request.manager_agent.brain_ids = merged_manager_brain_ids

        logger.info(
            f"[PLAYBOOK EXECUTOR] Merged brain_ids - "
            f"Agent: {merged_agent_brain_ids}, Manager: {merged_manager_brain_ids}"
        )

        # Merge brain_documents for agent (config + agent, no duplicates based on doc ID)
        agent_brain_documents = request.agent.brain_documents or []
        merged_agent_documents = self._merge_documents_without_duplicates(
            config_brain_documents,
            agent_brain_documents
        )
        request.agent.brain_documents = merged_agent_documents

        # Merge brain_documents for manager (config + manager, no duplicates based on doc ID)
        manager_brain_documents = request.manager_agent.brain_documents or []
        merged_manager_documents = self._merge_documents_without_duplicates(
            config_brain_documents,
            manager_brain_documents
        )
        request.manager_agent.brain_documents = merged_manager_documents

        logger.info(
            f"[PLAYBOOK EXECUTOR] Merged brain_documents - "
            f"Agent: {len(merged_agent_documents)} docs, Manager: {len(merged_manager_documents)} docs"
        )

        # Generate new session ID for the modified copy
        new_session_id = f"session-{uuid.uuid4()}"
        original_session_id = request.messageId

        try:
            logger.info(
                f"[PLAYBOOK EXECUTOR] Starting step re-execution with manager - "
                f"Original session_id: {original_session_id}, "
                f"call_id to match: {request.call_id}, "
                f"New session_id: {new_session_id}, "
                f"TaskId: {request.taskId}"
            )

            # Step 1: Retrieve ALL events from original session
            try:
                original_events = await self._retrieve_session_events(
                    session_id=original_session_id,
                    user_id=request.userId
                )
            except Exception as e:
                error_msg = f"Failed to retrieve session events: {str(e)}"
                logger.error(f"[PLAYBOOK EXECUTOR] {error_msg}")
                await self._send_error_message(queue, new_session_id, error_msg)
                return {
                    "success": False,
                    "new_session_id": new_session_id,
                    "error": error_msg
                }

            if not original_events:
                error_msg = f"No events found for session_id: {original_session_id}"
                logger.error(f"[PLAYBOOK EXECUTOR] {error_msg}")
                await self._send_error_message(queue, new_session_id, error_msg)
                return {
                    "success": False,
                    "new_session_id": new_session_id,
                    "error": error_msg
                }

            logger.info(
                f"[PLAYBOOK EXECUTOR] Retrieved {len(original_events)} events from session {original_session_id}"
            )

            try:
                await clone_citation_manager_state(
                    source_session_id=original_session_id,
                    target_session_id=new_session_id,
                )
            except Exception as e:
                logger.warning(
                    "[PLAYBOOK EXECUTOR] Failed to clone citation state from %s to %s: %s",
                    original_session_id,
                    new_session_id,
                    str(e),
                )

            # Step 2: Create a deep copy of all events
            copied_events = [event.model_copy(deep=True) for event in original_events]
            logger.info(
                f"[PLAYBOOK EXECUTOR] Created copy of {len(copied_events)} events"
            )

            # Step 3: Execute the step with new description
            logger.info(f"[PLAYBOOK EXECUTOR] Executing step: {request.agent.name}")
            step_execution_result = await self.execute_step_only(
                request,
                queue,
                copied_events,
                citation_session_id=new_session_id,
            )

            if not step_execution_result["success"]:
                error_msg = step_execution_result.get("error", "Step execution failed")
                logger.error(f"[PLAYBOOK EXECUTOR] {error_msg}")
                await self._send_error_message(queue, new_session_id, error_msg)
                return {
                    "success": False,
                    "new_session_id": new_session_id,
                    "error": error_msg
                }

            new_result = step_execution_result["result"]
            agent = step_execution_result["agent"]

            logger.info(
                f"[PLAYBOOK EXECUTOR] Step execution completed, got new result: {new_result[:100]}..."
            )

            # Step 4: Modify events with matching call_id
            modified_count = self._modify_events_by_call_id(
                events=copied_events,
                target_call_id=request.call_id,
                new_description=request.taskDescription,
                new_result=new_result
            )

            logger.info(
                f"[PLAYBOOK EXECUTOR] Modified {modified_count} events with call_id: {request.call_id}"
            )

            # Step 5: Filter out manager events after the step
            filtered_events = self._filter_events_up_to_call_id(
                events=copied_events,
                target_call_id=request.call_id
            )

            logger.info(
                f"[PLAYBOOK EXECUTOR] Filtered to {len(filtered_events)} events "
                f"(removed {len(copied_events) - len(filtered_events)} manager events)"
            )

            # Step 6: Reinject filtered events into database with new session_id
            try:
                await self._reinject_events_to_database(
                    events=filtered_events,
                    new_session_id=new_session_id,
                    user_id=request.userId,
                    agent=agent
                )

                logger.info(
                    f"[PLAYBOOK EXECUTOR] Successfully reinjected {len(filtered_events)} events "
                    f"into database with new session_id: {new_session_id}"
                )
            except Exception as e:
                error_msg = f"Error reinjecting events to database: {str(e)}"
                logger.error(f"[PLAYBOOK EXECUTOR] {error_msg}")
                await self._send_error_message(queue, new_session_id, error_msg)
                return {
                    "success": False,
                    "new_session_id": new_session_id,
                    "error": error_msg
                }

            # Step 7: Re-execute manager agent with updated context
            logger.info(f"[PLAYBOOK EXECUTOR] Re-executing manager agent")

            try:
                # Create config object for manager executor
                chatbot_name = request.manager_agent.chatbot_name
                if isinstance(chatbot_name, dict):
                    chatbot_name = chatbot_name.get('provider', chatbot_name.get('name', DEFAULT_MODEL))

                config = AgentTeamConfig(
                    session_id=new_session_id,
                    user_id=request.userId,
                    chatbot_name={'provider': chatbot_name},
                    doc_tree=None,
                    brain_tree=None,
                    brain_ids=request.manager_agent.brain_ids,
                    vectorstore_name=request.vectorstore_name
                )

                # Create manager executor
                manager_executor = PlaybookManagerExecutor(
                    agent_factory=self.agent_factory,
                    agent_runner=self.agent_runner,
                    streaming_formatter=self.streaming_formatter,
                    prompt_processor=self.prompt_processor,
                    llm_factory=self.llm_factory,
                    config=config
                )

                # Prepare all agents for delegation (convert request.agent to dict)
                all_agents = [{
                    'name': request.agent.name,
                    'description': request.agent.description,
                    'prompt': request.agent.prompt,
                    'tools': request.agent.tools,
                    'brain_ids': request.agent.brain_ids,
                    'brain_documents': [],
                    'brain_relations': {},
                    'vectorstore_name': request.vectorstore_name,
                    'chatbot_name': request.agent.chatbot_name,
                    'html': request.agent.html,
                    'save_memory': request.agent.save_memory,
                    'agent_params': request.agent.agent_params or {}
                }]

                # Execute manager
                manager_result = await manager_executor.execute_manager(
                    request=request,
                    session_id=new_session_id,
                    queue=queue,
                    all_agents=all_agents
                )

            except Exception as e:
                error_msg = f"Error executing manager: {str(e)}"
                logger.exception(f"[PLAYBOOK EXECUTOR] {error_msg}")
                # Don't fail the entire operation, just log the error
                # The step was successfully executed
                manager_result = f"Manager execution failed: {error_msg}"

            # Send completion signal
            await queue.put(None)

            return {
                "success": True,
                "new_session_id": new_session_id,
                "result": manager_result,
                "step_result": new_result,
                "modified_events_count": modified_count
            }

        except Exception as e:
            error_msg = f"Error in playbook step execution: {str(e)}"
            logger.exception(f"[PLAYBOOK EXECUTOR] {error_msg}")
            await self._send_error_message(queue, new_session_id, error_msg)
            return {
                "success": False,
                "new_session_id": new_session_id,
                "error": error_msg
            }

    async def _retrieve_session_events(
        self,
        session_id: str,
        user_id: str
    ) -> List[Any]:
        """Retrieve ALL events from an existing session.

        Args:
            session_id: The session ID to retrieve events from
            user_id: User ID for session access

        Returns:
            List of ALL events from the session, or empty list if session not found

        Raises:
            ConnectionError: If database connection fails
            ValueError: If session_id or user_id is invalid
            RuntimeError: If session retrieval fails for other reasons
        """
        if not session_id or not session_id.strip():
            raise ValueError("session_id cannot be empty")
        if not user_id or not user_id.strip():
            raise ValueError("user_id cannot be empty")

        try:
            # Construct app_name dynamically based on user_id
            app_name = f"{AGENT_MODE_PREFIX}{user_id}"

            # Create session service
            session_service = DatabaseSessionService(db_url=settings.DATABASE_URL)

            # Get the original session
            try:
                session = await session_service.get_session(
                    app_name=app_name,
                    user_id=user_id,
                    session_id=session_id
                )
            except SQLAlchemyError as e:
                logger.error(f"[PLAYBOOK EXECUTOR] Database query failed: {str(e)}")
                raise ConnectionError(f"Failed to query session: {str(e)}") from e

            if not session:
                logger.warning(
                    f"[PLAYBOOK EXECUTOR] Session not found for session_id: {session_id}"
                )
                raise ValueError(f"Session not found: {session_id}")

            events = session.events if hasattr(session, 'events') else []
            logger.info(
                f"[PLAYBOOK EXECUTOR] Retrieved {len(events)} events from session {session_id}"
            )

            return events

        except (ValueError, ConnectionError):
            # Re-raise known exceptions
            raise
        except Exception as e:
            logger.exception(
                f"[PLAYBOOK EXECUTOR] Unexpected error retrieving events for session_id {session_id}: {str(e)}"
            )
            raise RuntimeError(f"Failed to retrieve session events: {str(e)}") from e


    def _modify_events_by_call_id(
        self,
        events: List[Any],
        target_call_id: str,
        new_description: str,
        new_result: str
    ) -> int:
        """Find events with matching function_call.id or function_response.id and modify their content.

        The call_id is matched against:
        - FunctionCall.id in function_call events
        - FunctionResponse.id in function_response events

        Args:
            events: List of events to search through
            target_call_id: The FunctionCall.id or FunctionResponse.id to match
            new_description: New description to replace in function_call args
            new_result: New result to replace in function_response

        Returns:
            Number of events modified
        """
        modified_count = 0

        try:
            for event in events:
                # Check if event has content with parts
                if not event.content or not event.content.parts:
                    continue

                # Search through all parts of the event
                for part in event.content.parts:
                    # Check for function_call with matching id
                    if hasattr(part, 'function_call') and part.function_call:
                        if hasattr(part.function_call, 'id') and part.function_call.id == target_call_id:
                            logger.info(
                                f"[PLAYBOOK EXECUTOR] Found matching function_call with id: {target_call_id}"
                            )

                            # Modify the function_call args with new description
                            if hasattr(part.function_call, 'args') and part.function_call.args:
                                # Update task_description in args
                                if 'task_description' in part.function_call.args:
                                    part.function_call.args['task_description'] = new_description
                                    modified_count += 1
                                    logger.info(
                                        f"[PLAYBOOK EXECUTOR] Modified function_call task_description"
                                    )

                    # Check for function_response with matching id
                    elif hasattr(part, 'function_response') and part.function_response:
                        if hasattr(part.function_response, 'id') and part.function_response.id == target_call_id:
                            logger.info(
                                f"[PLAYBOOK EXECUTOR] Found matching function_response with id: {target_call_id}"
                            )

                            # Modify the function_response result with new result
                            if hasattr(part.function_response, 'response') and part.function_response.response:
                                if 'result' in part.function_response.response:
                                    part.function_response.response['result'] = new_result
                                    modified_count += 1
                                    logger.info(
                                        f"[PLAYBOOK EXECUTOR] Modified function_response result"
                                    )

            logger.info(
                f"[PLAYBOOK EXECUTOR] Total events modified: {modified_count} for call_id: {target_call_id}"
            )

        except Exception as e:
            logger.exception(
                f"[PLAYBOOK EXECUTOR] Error modifying events by call_id: {str(e)}"
            )

        return modified_count

    async def _reinject_events_to_database(
        self,
        events: List[Any],
        new_session_id: str,
        user_id: str,
        agent: Agent
    ) -> None:
        """Reinject modified events into PostgreSQL with new session_id.

        Args:
            events: List of modified events to inject
            new_session_id: New session ID for the injected events
            user_id: User ID
            agent: Agent for session creation

        Raises:
            ConnectionError: If database connection fails
            ValueError: If parameters are invalid
            RuntimeError: If event injection fails
        """
        if not events:
            raise ValueError("Cannot inject empty events list")
        if not new_session_id or not new_session_id.strip():
            raise ValueError("new_session_id cannot be empty")
        if not user_id or not user_id.strip():
            raise ValueError("user_id cannot be empty")
        if not agent:
            raise ValueError("agent cannot be None")

        session_service = None
        new_session = None
        injected_count = 0

        try:
            # Construct app_name dynamically based on user_id
            app_name = f"{AGENT_MODE_PREFIX}{user_id}"

            # Create session service
            session_service = DatabaseSessionService(db_url=settings.DATABASE_URL)
            # Extract agent metadata
            system_prompt = getattr(agent, 'instruction', None) if hasattr(agent, 'instruction') else None
            agent_name = getattr(agent, 'name', 'unknown') if hasattr(agent, 'name') else 'unknown'

            # Build session state
            state = {}
            if system_prompt:
                state["system_prompt"] = system_prompt
                state["agent_name"] = agent_name

            # Create new session
            logger.info(
                f"[PLAYBOOK EXECUTOR] Creating new session {new_session_id} for event reinjection"
            )

            try:
                new_session = await session_service.create_session(
                    app_name=app_name,
                    user_id=user_id,
                    session_id=new_session_id,
                    state=state or None
                )
            except SQLAlchemyError as e:
                logger.error(f"[PLAYBOOK EXECUTOR] Failed to create session: {str(e)}")
                raise ConnectionError(f"Failed to create session: {str(e)}") from e

            # Inject all events into new session
            logger.info(
                f"[PLAYBOOK EXECUTOR] Injecting {len(events)} events into new session"
            )

            failed_events = []
            for idx, event in enumerate(events):
                try:
                    # append_event takes the session object and event
                    await session_service.append_event(
                        session=new_session,
                        event=event
                    )
                    injected_count += 1

                    if (idx + 1) % LOG_INTERVAL == 0:  # Log progress every LOG_INTERVAL events
                        logger.info(
                            f"[PLAYBOOK EXECUTOR] Injected {idx + 1}/{len(events)} events"
                        )

                except SQLAlchemyError as e:
                    logger.error(
                        f"[PLAYBOOK EXECUTOR] Failed to inject event {idx}: {str(e)}"
                    )
                    failed_events.append(idx)
                    # Continue with other events even if one fails
                    continue
                except Exception as e:
                    logger.error(
                        f"[PLAYBOOK EXECUTOR] Unexpected error injecting event {idx}: {str(e)}"
                    )
                    failed_events.append(idx)
                    continue

            # Check if we had too many failures
            failure_rate = len(failed_events) / len(events) if events else 0
            if failure_rate > 0.5:  # More than 50% failed
                error_msg = f"Too many events failed to inject: {len(failed_events)}/{len(events)}"
                logger.error(f"[PLAYBOOK EXECUTOR] {error_msg}")
                raise RuntimeError(error_msg)

            logger.info(
                f"[PLAYBOOK EXECUTOR] Successfully injected {injected_count}/{len(events)} events "
                f"into session {new_session_id} ({len(failed_events)} failed)"
            )

        except (ValueError, ConnectionError, RuntimeError):
            # Re-raise known exceptions
            raise
        except Exception as e:
            logger.exception(
                f"[PLAYBOOK EXECUTOR] Unexpected error reinjecting events: {str(e)}"
            )
            raise RuntimeError(f"Failed to reinject events: {str(e)}") from e


    async def _send_error_message(
        self,
        queue: asyncio.Queue[dict],
        session_id: str,
        error_message: str
    ):
        """Send error message through the queue.

        Args:
            queue: The queue to send the error message to
            session_id: Session ID for the error message
            error_message: The error message to send
        """
        try:
            # Send formatted error event
            error_output = self.streaming_formatter.format_streaming_event(
                agent_name="System",
                agent_type="error",
                chunk=f"Error: {error_message}",
                message_id=session_id,
                content_type="error"
            )
            await queue.put(error_output)

            # Send final error status with structured error field
            final_error = {
                "error": error_message,
                "success": False,
                "session_id": session_id
            }
            await queue.put(final_error)

            await queue.put(None)  # Signal completion
        except Exception as e:
            logger.error(
                f"[PLAYBOOK EXECUTOR] Failed to send error message: {str(e)}"
            )
            # Try to send at least a basic error message
            try:
                await queue.put({
                    "error": f"Critical error: {str(e)}",
                    "success": False
                })
                await queue.put(None)
            except:
                pass


# Create a singleton instance
_executor = None


async def execute_playbook_step(
    request: RunPlaybookStepRequest,
    queue: asyncio.Queue[dict]
) -> Dict[str, Any]:
    """Main entry point for executing a playbook step.

    This function is called by the endpoint to re-execute a playbook step
    with a new description while preserving the session context.

    Args:
        request: The playbook step execution request
        queue: Queue for streaming response events

    Returns:
        Dict containing execution results
    """
    _executor = PlaybookStepExecutor()

    return await _executor.execute_step(request, queue)

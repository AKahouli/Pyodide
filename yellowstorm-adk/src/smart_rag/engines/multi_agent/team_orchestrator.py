"""Agent team management and execution system.

This module provides the core agent team functionality that orchestrates multiple
specialized agents to handle complex user queries. It manages agent suggestions,
delegation, tool assignment, and streaming communication.

Classes:
    AutoAgentGenerationTeam: Main orchestrator for agent team operations.
"""

import asyncio
import time
from typing import Dict, Any, Optional, List, Union, Tuple



# Delayed imports for google.adk to speed up startup
def get_adk_runner():
    from google.adk import Runner
    return Runner

def get_adk_agent():
    from google.adk import Agent
    return Agent

def get_database_session_service():
    from google.adk.sessions import DatabaseSessionService
    return DatabaseSessionService

def get_in_memory_session_service():
    from google.adk.sessions import InMemorySessionService
    return InMemorySessionService

from src.smart_rag.infrastructure.processing.plugin import CleanSessionPlugin

from src.smart_rag.tools.utilities.tool_utils import extract_tool_names
from src.smart_rag.engines.multi_agent.config import langfuse_client, AgentTeamConfig
from src.smart_rag.agents.core.helpers import AgentHelper
from src.smart_rag.agents.core.document_helpers import DocumentHelpers
from src.smart_rag.engines.multi_agent.streaming_processor import StreamingEventProcessor
from src.smart_rag.infrastructure.external.message_helper import MessageHelper
from src.logger.logging import get_logger

# Import the decomposed components
from src.smart_rag.agents.generators.suggestions_generator import AgentSuggestionGenerator
from src.smart_rag.agents.core.repository import AgentRepository
from src.smart_rag.agents.factories.delegation_factory import AgentDelegationFactory
from src.smart_rag.agents.factories.manager_factory import ManagerAgentFactory
# Import the decomposed components
from src.smart_rag.agents.tools.tools_manager import AgentToolsManager
from src.smart_rag.infrastructure.memory.memory_service import MemoryService
from src.smart_rag.messaging.transformers import MessageTransformer
from src.smart_rag.tools.utilities.core_utils import build_tree
from src.smart_rag.infrastructure.processing.context_builder import ContextBuilder
from src.smart_rag.tools.infrastructure.tool_descriptions import ToolDescriptionProvider
from src.smart_rag.messaging.component_tracker import ComponentTracker

# Import classes that tests expect to be available at module level
from src.smart_rag.infrastructure.session.citation_manager import SessionCitationManager
# Import classes that tests expect to be available at module level
from src.config.settings import get_settings


settings = get_settings()
logger = get_logger("api.routers.agentic_rag.AutoAgentGenerationTeam")



class AutoAgentGenerationTeam:
    """A team of agents that suggest and generate specialized agents based on user prompts.
    
    This class orchestrates a dynamic team of AI agents that can suggest, create,
    and manage specialized agents based on user queries. It handles agent delegation,
    tool management, streaming responses, and execution tracking.
    
    The team consists of:
    - Manager agent: Coordinates other agents and handles high-level decisions
    - Specialized agents: Domain-specific agents created based on user needs
    - Tool management: Assigns appropriate tools to agents
    - Streaming processor: Handles real-time communication with clients
    
    Attributes:
        config (AgentTeamConfig): Configuration for the agent team.
        prompt_processor: Processor for handling and formatting prompts.
        llm_factory: Factory for creating language model instances.
        agent_factory: Factory for creating new agents.
        agent_runner: Runner for executing agent operations.
        streaming_formatter: Formatter for streaming responses.
        event_extractor: Extractor for processing events.
        chatbot_name (Dict): Configuration for chatbot naming.
        current_queue: Current streaming queue for responses.
    """

    def __init__(self, config: Optional[AgentTeamConfig] = None, prompt_processor=None, llm_factory=None,
                 agent_factory=None, agent_runner=None, streaming_formatter=None, event_extractor=None,
                 chatbot_name: Optional[Dict] = None):
        """Initialize the AutoAgentGenerationTeam.

        Args:
            config (AgentTeamConfig): Configuration object for the agent team.
            prompt_processor: Processor for handling and formatting prompts.
            llm_factory: Factory for creating language model instances.
            agent_factory: Factory for creating new agent instances.
            agent_runner: Runner for executing agent operations and agentic_workflows.
            streaming_formatter: Formatter for converting responses to streaming format.
            event_extractor: Extractor for processing and analyzing events.
            chatbot_name (Dict): Configuration dictionary for chatbot naming and branding.
        """
        self.config = config
        self.prompt_processor = prompt_processor
        self.llm_factory = llm_factory
        self.agent_factory = agent_factory
        self.agent_runner = agent_runner
        self.streaming_formatter = streaming_formatter
        self.event_extractor = event_extractor
        self.current_queue = None
        if isinstance(chatbot_name, dict):
            chatbot_name = str(chatbot_name.get('provider'))
        self.chatbot_name = chatbot_name

        # Initialize components only if config is provided
        if config is not None:
            self._message_helper = MessageHelper()
            self.agent_helper = AgentHelper()
            self.document_helper = DocumentHelpers()
            self.agent_repository = AgentRepository(self.agent_helper)
            self.context_builder = ContextBuilder()
            self.tool_description_provider = ToolDescriptionProvider()
            # The citation manager will be initialized per request using the registry
            self.citation_manager = None
            self.delegation_factory = AgentDelegationFactory(self.config, self.agent_factory, self.agent_runner, self.agent_repository, self.agent_helper, self.tool_description_provider, self.citation_manager)
            self.agent_tools_manager = AgentToolsManager(self.agent_repository, self.delegation_factory, self.agent_helper)
            self.manager_factory = ManagerAgentFactory(self.config, self.prompt_processor, llm_factory, self.agent_repository, self.tool_description_provider, self.context_builder, self.agent_helper)
            self.streaming_processor = StreamingEventProcessor(self.config, streaming_formatter, self.agent_repository)
            self.suggestion_generator = AgentSuggestionGenerator(self.prompt_processor, self.llm_factory, self.chatbot_name)
            self.memory_service = MemoryService()

    def get_agent_id_by_name(self, name: str) -> Optional[str]:
        """Get an agent's ID by its name.
        
        Args:
            name (str): The name of the agent whose ID is needed.
        
        Returns:
            Optional[str]: The agent's unique identifier if found, None otherwise.
        """
        return self.agent_repository.get_agent_id_by_name(name)

    def has_search_agents(self) -> bool:
        """Check if any of the current agents have search tools.
        
        Returns:
            bool: True if any agent in the team has search capabilities, False otherwise.
        """
        return self.agent_repository.has_search_agents()

    def has_code_interpreter(self) -> bool:
        """Check if any of the current agents have search tools.

        Returns:
            bool: True if any agent in the team has search capabilities, False otherwise.
        """
        return self.agent_repository.has_code_interpreter()

    def get_document_tree_info(self, doc_tree, brain_tree) -> str:
        """Get formatted document tree information for inclusion in prompts.
        
        Args:
            doc_tree: Document tree structure containing available documents.
            brain_tree: Brain tree structure containing knowledge organization.
        
        Returns:
            str: Formatted string representation of document tree information
                suitable for inclusion in agent prompts.
        """
        return self.manager_factory._get_document_tree_info(doc_tree, brain_tree)

    async def get_agent_suggestions(self, suggestions_prompt: str, user_prompt: str,session_id:str,available_agents: List[Dict[str, Any]],
                                    brain_documents: Optional[List] = None, brain_relations: Optional[Dict] = None,
                                    available_tools: Optional[List[Dict[str, Any]]] = None) -> \
            List[Dict[str, Any]]:
        """Generate agent suggestions based on the user prompt.
        
        Analyzes the user prompt and available knowledge to suggest specialized
        agents that would be most effective for handling the query.
        
        Args:
            suggestions_prompt (str): Template prompt for generating suggestions.
            user_prompt (str): The original user query to analyze.
            report_writer_prompt (str): Prompt for report writing capabilities.
            brain_documents (Optional[List]): Available documents for context.
            brain_relations (Optional[Dict]): Relationship mappings between concepts.
        
        Returns:
            List[Dict[str, Any]]: List of suggested agent configurations with
                their capabilities, tools, and specializations.
        """
        response, agent_id_mapping = await self.suggestion_generator.generate_suggestions(session_id,
            suggestions_prompt, user_prompt, available_agents, self.config, brain_documents, brain_relations
        )
        suggestions = response.get('suggestions', []) if response else []
        available_agent_ids = response.get('available_agent_ids', []) if response else []

        # Build tool catalog from available_tools
        tool_catalog = {}
        if available_tools:
            for tool in available_tools:
                tool_name = tool.get('name')
                if tool_name:
                    config = {"name": tool_name}
                    for attr in tool.get('attributes', []):
                        attr_name = attr.get('name')
                        attr_value = attr.get('value')
                        if attr_name and attr_value is not None:
                            config[attr_name] = attr_value
                    tool_catalog[tool_name] = config
        normalized_agent_map: Dict[str, Dict[str, Any]] = {}
        final_agents: List[Dict[str, Any]] = []

        for provided_agent in available_agents or []:
            provided_data = provided_agent.dict() if hasattr(provided_agent, "dict") else provided_agent
            normalized_name = self.agent_helper.normalize_agent_name(provided_data.get('name', ''))
            if normalized_name:
                normalized_agent_map[normalized_name] = provided_data

        for agent_id in available_agent_ids:
            # Handle both numeric IDs ("2") and prefixed IDs ("id2")
            mapped_agent_id = agent_id if agent_id.startswith("id") else f"id{agent_id}"
            if mapped_agent_id in agent_id_mapping:
                agent = agent_id_mapping[mapped_agent_id]
                actual_agent = {
                    "id": agent.id,  # use the agent's id attribute, not the object itself
                    "name": agent.name,
                    "description": agent.description,
                    "prompt": agent.prompt,
                    "tools": agent.tools,
                    "chatbot_name": agent.chatbot_name,
                    "brain_documents": agent.brain_documents,
                    "brain_relations": agent.brain_relations,
                    "brain_ids": agent.brain_ids,
                    "vectorstore_name": agent.vectorstore_name,
                    "agent_params": agent.agent_params if hasattr(agent, 'agent_params') else {},
                    "save_memory": agent.save_memory,
                }

                # Handle workspace merging for available agents with search tools
                tools = actual_agent.get('tools', []) or []
                tool_names = extract_tool_names(tools)
                if 'search' in tool_names:
                    # Store original agent-specific documents before merging
                    self.document_helper._store_original_brain_data(actual_agent)

                    # Get config workspace
                    config_workspace = brain_documents if brain_documents is not None else self.config.doc_tree
                    config_relations = brain_relations if brain_relations is not None else self.config.brain_tree

                    # Check if agent has assigned workspace
                    agent_docs = actual_agent.get('brain_documents') or []
                    agent_relations = actual_agent.get('brain_relations') or {}
                    agent_has_workspace = bool(agent_docs or agent_relations)

                    if agent_has_workspace:
                        # Agent has assigned workspace - merge with config (no duplicates based on doc IDs)
                        actual_agent['brain_documents'] = self.document_helper._merge_documents_without_duplicates(
                            config_workspace or [],
                            agent_docs
                        )
                        actual_agent['brain_relations'] = self.document_helper._merge_brain_relations(
                            config_relations or {},
                            agent_relations
                        )
                        # Merge brain_ids from both agent and config (no duplicates)
                        agent_brain_ids = actual_agent.get('brain_ids', []) or []
                        config_brain_ids = self.config.brain_ids or []
                        merged_brain_ids = list(config_brain_ids)
                        for brain_id in agent_brain_ids:
                            if brain_id not in merged_brain_ids:
                                merged_brain_ids.append(brain_id)
                        actual_agent["brain_ids"] = merged_brain_ids
                    else:
                        # Agent has no workspace - use only config
                        actual_agent['brain_documents'] = config_workspace
                        actual_agent['brain_relations'] = config_relations
                        actual_agent["brain_ids"] = self.config.brain_ids

                    actual_agent["vectorstore_name"] = self.config.vectorstore_name

                normalized_name = self.agent_helper.normalize_agent_name(actual_agent.get('name', ''))
                if normalized_name:
                    normalized_agent_map[normalized_name] = actual_agent
                    if not any(
                        self.agent_helper.normalize_agent_name(existing.get('name', '')) == normalized_name
                        for existing in final_agents
                    ):
                        final_agents.append(actual_agent)
                else:
                    final_agents.append(actual_agent)

        for suggestion in suggestions:
            tools = suggestion.get('tools', []) or []
            # Resolve tool names to full configs
            if tools and isinstance(tools[0], str) and tool_catalog:
                resolved_tools = []
                for tool_name in tools:
                    if tool_name in tool_catalog:
                        resolved_tools.append(tool_catalog[tool_name].copy())
                suggestion['tools'] = resolved_tools
                tools = resolved_tools

            # Extract tool names from flexible format
            tool_names = extract_tool_names(tools)
            if 'search' in tool_names:
                # Store original agent-specific documents before merging
                self.document_helper._store_original_brain_data(suggestion)

                # Get config workspace
                config_workspace = brain_documents if brain_documents is not None else self.config.doc_tree
                config_relations = brain_relations if brain_relations is not None else self.config.brain_tree

                # Check if agent has assigned workspace
                agent_docs = suggestion.get('brain_documents') or []
                agent_relations = suggestion.get('brain_relations') or {}
                agent_has_workspace = bool(agent_docs or agent_relations)

                if agent_has_workspace:
                    # Agent has assigned workspace - merge with config (no duplicates based on doc IDs)
                    suggestion['brain_documents'] = self.document_helper._merge_documents_without_duplicates(
                        config_workspace or [],
                        agent_docs
                    )
                    suggestion['brain_relations'] = self.document_helper._merge_brain_relations(
                        config_relations or {},
                        agent_relations
                    )
                    # Merge brain_ids from both agent and config (no duplicates)
                    agent_brain_ids = suggestion.get('brain_ids', []) or []
                    config_brain_ids = self.config.brain_ids or []
                    merged_brain_ids = list(config_brain_ids)
                    for brain_id in agent_brain_ids:
                        if brain_id not in merged_brain_ids:
                            merged_brain_ids.append(brain_id)
                    suggestion["brain_ids"] = merged_brain_ids
                else:
                    # Agent has no workspace - use only config
                    suggestion['brain_documents'] = config_workspace
                    suggestion['brain_relations'] = config_relations
                    suggestion["brain_ids"] = self.config.brain_ids

                suggestion["vectorstore_name"] = self.config.vectorstore_name

            normalized_name = self.agent_helper.normalize_agent_name(suggestion.get('name', ''))
            if normalized_name and normalized_name in normalized_agent_map:
                logger.debug(f"Reusing existing agent definition for suggested agent '{suggestion.get('name', '')}'")
                existing_agent = normalized_agent_map[normalized_name]
                if not any(
                    self.agent_helper.normalize_agent_name(existing.get('name', '')) == normalized_name
                    for existing in final_agents
                ):
                    final_agents.append(existing_agent)
                continue

            if normalized_name:
                normalized_agent_map[normalized_name] = suggestion
            final_agents.append(suggestion)

        self.agent_repository.set_agents(final_agents)
        return final_agents
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
    def make_delegate_function(self, agent_name: str, q: Optional[asyncio.Queue[dict]] = None,
                               search_web: Optional[bool] = False, parent_span=None) -> Any:
        """Create a delegate function for the agent.
        
        Creates a callable function that can be used to delegate tasks to a
        specific agent in the team.
        
        Args:
            agent_name (str): Name of the agent to create delegation function for.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses.
            search_web (Optional[bool]): Whether the agent should have web search capabilities.
            parent_span: Langfuse span for tracking delegation operations.
        
        Returns:
            Any: Callable function that can be used to delegate tasks to the specified agent.
        """
        return self.delegation_factory.make_delegate_function(agent_name, q, search_web, parent_span)

    async def run_agent_team(self, user_prompt: str, manager_prompt: str,  session_id: str, manager_memory:bool,
                             q: Optional[asyncio.Queue[dict]] = None, manager_temperature: float=None, parent_trace=None,  image_input: Optional[List[Dict]] = None, original_agents: Optional[List] = None) -> None:
        """Run the agent team based on user prompt.

        Orchestrates the execution of the entire agent team to handle a user query.
        Creates a manager agent, assigns tools, manages streaming responses,
        and tracks execution metrics.

        Args:
            user_prompt (str): The original user query to process.
            manager_prompt (str): Prompt template for the manager agent.
            session_id (str): Unique identifier for the current session.
            manager_memory (bool): Whether to save manager conversation to memory.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses to client.
            parent_trace: Langfuse trace for tracking the entire operation.
            image_input (Optional[List[Dict]]): List of images in format [{"label": "base64..."}, ...].

        Returns:
            None

        Raises:
            Exception: If agent team execution fails, logs error and updates
                tracking spans with failure information.
        """
        logger.info(f"Starting agent team execution - session_id: {session_id}, agent_count: {len(self.agent_repository.get_all_agents())}")

        # Get consolidated document tree info for manager
        consolidated_doc_info = ""
        if self.agent_repository.has_search_agents() or self.agent_repository.has_code_interpreter():
            consolidated_doc_info = self.document_helper._get_consolidated_document_tree_info_for_manager(
                self.config,
                self.agent_repository.get_all_agents()
            )

        # Create span for agent team execution
        team_execution_span = langfuse_client.span(
            trace_id=session_id,
            parent_observation_id=parent_trace.id if parent_trace else None,
            name="Manager",
            input={
                "user_prompt": user_prompt,
                "image_input": True if image_input else False,
                "manager_prompt": manager_prompt,
                "agent_count": len(self.agent_repository.get_all_agents()),
                "available_documents_for_all_agents": consolidated_doc_info if consolidated_doc_info else "No documents available",
            },
        )

        try:
            # Get citation manager for this session FIRST before creating any tools
            from src.smart_rag.infrastructure.session.citation_manager import get_citation_manager
            self.citation_manager = await get_citation_manager(session_id)
            # Update delegation factory with the citation manager
            self.delegation_factory.citation_manager = self.citation_manager

            # Initialize component tracker for this session
            component_tracker = ComponentTracker(session_id)
            logger.info(f"[ComponentTracker] Initialized for session {session_id}")

            # Pass component tracker to all formatters
            if hasattr(self.streaming_processor, 'streaming_formatter'):
                self.streaming_processor.streaming_formatter.component_tracker = component_tracker
                logger.info(f"[ComponentTracker] Assigned to streaming_processor.streaming_formatter")

            # Also assign to agent_runner's formatter
            if hasattr(self.agent_runner, 'streaming_formatter'):
                self.agent_runner.streaming_formatter.component_tracker = component_tracker
                logger.info(f"[ComponentTracker] Assigned to agent_runner.streaming_formatter")

            # And to the main streaming_formatter
            if hasattr(self, 'streaming_formatter'):
                self.streaming_formatter.component_tracker = component_tracker
                logger.info(f"[ComponentTracker] Assigned to main streaming_formatter")

            enriched_manager_prompt = manager_prompt
            if manager_memory:
                await self.memory_service.initialize()
                # Set the same memory service for agent delegation
                self.delegation_factory.set_memory_service(self.memory_service)
                memory_context = await self.memory_service.create_manager_context(user_prompt, self.config.user_id)
                enriched_manager_prompt = manager_prompt + memory_context
                logger.info(f"Manager memory enabled, enriched prompt with context - session_id: {session_id}")
            else:
                logger.info(f"Manager memory disabled, using base prompt without memory context - session_id: {session_id}")


            agents_to_check = original_agents if original_agents is not None else self.agent_repository.get_all_agents()
            manager_tools = self.agent_helper.get_manager_tools_from_agents(agents_to_check)

            # Set image input on delegation factory so delegate functions can pass images to subagents
            self.delegation_factory.set_image_input(image_input)

            # Now create tools AFTER setting citation manager
            tools = self.agent_tools_manager.create_tools_from_all_agents(q, True)

            manager_agent = self.manager_factory.create_manager_agent(enriched_manager_prompt, tools,
                                                                      self.delegation_factory, manager_temperature,
                                                                      manager_specific_tools=manager_tools)
            self.current_queue = q

            # Session initialization with freeze debugging
            session_init_start = time.time()
            logger.info(f"[FREEZE DEBUG] Creating DatabaseSessionService for session {session_id}, user {self.config.user_id}")
            db_service_start = time.time()
            data_base_session=get_database_session_service()(db_url=settings.DATABASE_URL)
            db_service_duration = time.time() - db_service_start
            logger.info(f"[FREEZE DEBUG] DatabaseSessionService created in {db_service_duration:.3f}s")

            get_session_start = time.time()
            logger.info(f"[FREEZE DEBUG] Calling get_session() with app_name=Agent_mode_{self.config.user_id}")
            exsiting_session=await data_base_session.get_session(app_name=f"Agent_mode_{self.config.user_id}",user_id=self.config.user_id,session_id=session_id)
            get_session_duration = time.time() - get_session_start

            if exsiting_session:
                logger.info(f"[FREEZE DEBUG] Existing session found in {get_session_duration:.3f}s for session {session_id}")
            else:
                logger.info(f"[FREEZE DEBUG] No existing session found in {get_session_duration:.3f}s for session {session_id}")

            def extract_tools_info( agent: Any) -> List[Dict[str, str]]:
                """Extract tools information from agent.

                Args:
                    agent: The agent object containing tools

                Returns:
                    List[Dict[str, str]]: List of dictionaries containing tool name, description, and prompt
                """
                extract_start = time.time()
                logger.info(f"[FREEZE DEBUG] extract_tools_info STARTED for session {session_id}")
                tools_info = []
                try:
                    if not (hasattr(agent, 'tools') and agent.tools):
                        logger.info(f"[FREEZE DEBUG] extract_tools_info: No tools found on agent")
                        return tools_info

                    for tool in agent.tools:
                        tool_data = self._extract_tool_data(tool)
                        tools_info.append(tool_data)

                    if tools_info:
                        logger.info(f"[FREEZE DEBUG] Extracted {len(tools_info)} tools from agent")

                except Exception as e:
                    logger.error(f"[FREEZE DEBUG] Failed to extract tools info from agent: {str(e)}")

                extract_duration = time.time() - extract_start
                logger.info(f"[FREEZE DEBUG] extract_tools_info COMPLETED in {extract_duration:.3f}s")
                return tools_info
            if not exsiting_session:
                logger.info(f"[FREEZE DEBUG] No existing session, creating new session for session {session_id}")
                metadata_start = time.time()
                agent_name=getattr(manager_agent, 'name', "unknown") if hasattr(manager_agent, 'name') else "unknown"
                system_prompt=getattr(manager_agent, 'instruction', None) if hasattr(manager_agent, 'instruction') else None
                logger.info(f"[FREEZE DEBUG] Extracted agent metadata: name={agent_name}, has_prompt={system_prompt is not None}")

                logger.info(f"[FREEZE DEBUG] Calling extract_tools_info() for agent {agent_name}")
                tools_info_result = extract_tools_info(manager_agent)
                metadata_duration = time.time() - metadata_start
                logger.info(f"[FREEZE DEBUG] Agent metadata and tools extracted in {metadata_duration:.3f}s")

                state= {
                    "system_prompt": system_prompt,
                    "agent_name": agent_name,
                    "tools_info": tools_info_result,
                }
                logger.info(f"[FREEZE DEBUG] Session state prepared with {len(tools_info_result)} tools")

                create_session_start = time.time()
                logger.info(f"[FREEZE DEBUG] Calling create_session() for session {session_id}")
                await data_base_session.create_session(app_name=f"Agent_mode_{self.config.user_id}", user_id=self.config.user_id,
                                                       session_id=session_id,state=state)
                create_session_duration = time.time() - create_session_start
                logger.info(f"[FREEZE DEBUG] create_session() COMPLETED in {create_session_duration:.3f}s")

            session_init_duration = time.time() - session_init_start
            logger.info(f"[FREEZE DEBUG] Total session initialization completed in {session_init_duration:.3f}s")

            runner_start = time.time()
            logger.info(f"[FREEZE DEBUG] Creating Runner for session {session_id}")
            agent_runner=get_adk_runner()(
                agent=manager_agent,
                app_name=f"Agent_mode_{self.config.user_id}",
                session_service=data_base_session,
                plugins=[CleanSessionPlugin()],
            )
            runner_duration = time.time() - runner_start
            logger.info(f"[FREEZE DEBUG] Runner created in {runner_duration:.3f}s")
            # Process streaming events and capture the manager response
            manager_response = await self.streaming_processor.process_streaming_events( session_id, user_prompt, manager_agent, agent_runner, q, team_execution_span, image_input
            )

            # Explicitly flush to ensure traces are sent to Langfuse
            try:
                langfuse_client.flush()
            except Exception as e:
                logger.exception(f"Failed to flush Langfuse client: {str(e)}")

            logger.info(f"Agent team execution completed successfully - session_id: {session_id}")

            # Persist citation manager state to DB after successful final response
            try:
                if self.citation_manager:
                    await self.citation_manager.global_manager._save_state()
                    logger.info(f"[TEAM_ORCHESTRATOR] Citation manager state saved for session {session_id}")
            except Exception as e:
                logger.error(f"[TEAM_ORCHESTRATOR] Failed to save citation manager state: {str(e)}")

            # Send stream end signal immediately after streaming to avoid blocking user experience
            if q:
                logger.info(f"[AUTO MODE] Sending stream end (None) to backend - session_id: {session_id}")
                await q.put(None)

            # Save manager conversation to memory with actual response (after stream end) if enabled
            if manager_memory:
                conversation_messages = [
                    {"role": "user", "content": user_prompt},
                    {"role": "assistant", "content": manager_response if manager_response else "Manager agent completed the request"}
                ]
                await self.memory_service.save_manager_conversation(conversation_messages, self.config.user_id)
                logger.info(f"Manager conversation saved to memory - session_id: {session_id}")
            else:
                logger.info(f"Manager memory disabled, skipping conversation save - session_id: {session_id}")

        except Exception as e:
            logger.exception(f"Error running agent team: {str(e)}")
            team_execution_span.event(
                name="error",
                output={
                    "error_message": str(e),
                    "error_type": "agent_team_execution_error"
                }
            )
            team_execution_span.update(output={
                "execution_completed": False,
                "error": str(e)
            })
            if q:
                # Send error component
                import uuid
                error_component = {
                    "action": "add",
                    "component": {
                        "id": str(uuid.uuid4()),
                        "type": "error",
                        "data": {
                            "title": "Exception",
                            "content": "The model couldn't finish your answer due to an unexpected error."
                        }
                    },
                    "metadata": {
                        "message_id": session_id
                    }
                }
                logger.info(f"[AUTO MODE] Sending error component to backend - session_id: {session_id}, error: {str(e)}")
                await q.put(error_component)

                logger.info(f"[AUTO MODE] Sending stream end (None) to backend after error - session_id: {session_id}")
                await q.put(None)

    async def _create_agent_team(self, team_config, session_id):
        """Create an agent team from configuration."""
        from src.smart_rag.agents.factories.base_factory import AgentFactory

        class AgentTeam:
            def __init__(self):
                self.agents = []
                self.manager = None
                self.workflow_mode = "sequential"

        team = AgentTeam()
        team.workflow_mode = getattr(team_config, 'workflow_mode', 'sequential')
        if hasattr(team_config, 'agents'):
            agent_factory = AgentFactory(self.prompt_processor,self.llm_factory,self.citation_manager)
            for agent_config in team_config.agents:
                if hasattr(agent_config, 'type'):
                    if agent_config.type == 'search':
                        doc_tree, brain_tree = None, None
                        top_k=1
                        if hasattr(agent_config, 'brain_documents') and hasattr(agent_config, 'brain_relations'):
                            if agent_config.brain_documents is not None and agent_config.brain_relations is not None:
                                doc_tree,brain_tree = build_tree(agent_config.brain_documents, agent_config.brain_relations)
                        for tool in agent_config.tools:
                            if tool.get('name') == 'search':
                                top_k= tool.get('top_k', 5)
                        vectorstore_name= getattr(agent_config, 'vectorstore_name', self.config.vectorstore_name)
                        brain_ids= getattr(agent_config, 'brain_ids', self.config.brain_ids)
                        chatbot_name= getattr(agent_config, 'chatbot_name', self.chatbot_name)
                        agent_name= getattr(agent_config, 'name', 'Search Agent')
                        agent_max_tokens= getattr(agent_config, 'agent_params', {}).get('max_tokens', 20000)
                        agent_temp= getattr(agent_config, 'agent_params', {}).get('agent_temp', 0.0)

                        agent, _, _ = agent_factory.create_search_agent(
                            doc_tree=doc_tree,
                            brain_tree=brain_tree,
                            brain_ids=brain_ids,
                            top_k=top_k,
                            vectorstore_name=vectorstore_name,
                            search_web="off",
                            prompt=agent_config.prompt,
                            task_order=None,
                            chatbot_name=chatbot_name,
                            max_tokens=agent_max_tokens,
                            temperature=agent_temp,
                            name=agent_name,
                            citation_manager=self.citation_manager
                        )
                        team.agents.append(agent)
                    elif agent_config.type == 'report':
                        agent = agent_factory.create_report_writer_agent()
                        team.agents.append(agent)

            # Create manager
            manager_prompt = getattr(team_config, 'manager_prompt', 'Coordinate the team effectively')
            team.manager = agent_factory.create_manager_agent(manager_prompt, self.chatbot_name, [])

        return team

    async def _execute_team_workflow(self, team, request, queue):
        """Execute team workflow based on mode."""
        if team.workflow_mode == "sequential":
            return await self._run_sequential_workflow(team, request, queue)
        elif team.workflow_mode == "parallel":
            return await self._run_parallel_workflow(team, request, queue)
        else:
            return "Workflow completed"

    async def _run_sequential_workflow(self, team, request, queue):
        """Run agents sequentially."""
        results = []

        # Run each agent in sequence
        for agent in team.agents:
            result, _, _, _ = await self._run_agent(agent, request.user_prompt, queue)
            results.append(result)

        # Run manager last
        if team.manager:
            final_result, _, _, _ = await self._run_agent(team.manager, request.user_prompt, queue)
            return final_result

        return "Sequential workflow completed"

    async def _run_parallel_workflow(self, team, request, queue):
        """Run agents in parallel."""
        # Run agents in parallel
        tasks = []
        for agent in team.agents:
            task = asyncio.create_task(self._run_agent(agent, request.user_prompt, queue))
            tasks.append(task)

        # Wait for all agents to complete
        results = await asyncio.gather(*tasks)

        # Run manager to synthesize results
        if team.manager:
            final_result, _, _, _ = await self._run_agent(team.manager, request.user_prompt, queue)
            return final_result

        return "Parallel workflow completed"

    async def _run_agent(self, agent, task, queue):
        """Run an individual agent."""
        from src.smart_rag.agents.core.runner import AgentRunner
        message_transformer=MessageTransformer()

        runner = AgentRunner(self.event_extractor,message_transformer,self.streaming_formatter,self.prompt_processor)
        session_helper = get_in_memory_session_service()()

        result = await runner.run_agent_tool(agent, task, session_helper, queue)
        return result


    async def _delegate_task_to_agent(self, team, task, task_type, queue):
        """Delegate a specific task to a specific agent."""
        matched_agent = self._match_agent_to_task(team.agents, task, task_type)
        if matched_agent:
            return await self._run_agent(matched_agent, task, queue)
        return ("No suitable agent found", False, {}, [])

    def _match_agent_to_task(self, agents, task, task_type):
        """Match agents to tasks based on capabilities."""
        for agent in agents:
            if hasattr(agent, 'capabilities') and task_type in [cap.replace('_', '') for cap in agent.capabilities]:
                return agent
            elif hasattr(agent, 'name'):
                if (task_type == 'search' and 'search' in agent.name.lower()) or \
                   (task_type == 'analysis' and 'analysis' in agent.name.lower()):
                    return agent
        return agents[0] if agents else None

    async def _coordinate_agent_communication(self, sender_agent, receiver_agent, message, context):
        """Coordinate communication between agents."""
        formatted_message = self._format_inter_agent_message(sender_agent, receiver_agent, message, context)
        return formatted_message

    def _format_inter_agent_message(self, sender_agent, receiver_agent, message, context):
        """Format inter-agent messages."""
        return f"From {sender_agent.name} to {receiver_agent.name}: {message}"

    def _validate_team_configuration(self, config):
        """Validate team configuration."""
        if not hasattr(config, 'agents') or not config.agents:
            return False
        if not hasattr(config, 'manager_prompt') or not config.manager_prompt:
            return False
        return True

    async def _handle_workflow_error(self, error, context, queue):
        """Handle workflow errors."""
        error_response = self._create_error_response(error, context)
        return error_response

    def _create_error_response(self, error, context):
        """Create error response."""
        return f"Error handled gracefully: {str(error)}"

    def _get_team_performance_metrics(self, execution_log):
        """Get team performance metrics."""
        total_duration = sum(entry.get('duration', 0) for entry in execution_log)
        success_count = sum(1 for entry in execution_log if entry.get('status') == 'success')
        agent_count = len(execution_log)

        return {
            'total_duration': total_duration,
            'agent_count': agent_count,
            'success_rate': success_count / agent_count if agent_count > 0 else 0.0,
            'average_duration': total_duration / agent_count if agent_count > 0 else 0.0
        }

    async def _optimize_team_workflow(self, team_config, performance_data):
        """Optimize team workflow based on performance."""
        # Simple optimization logic
        optimized_config = team_config
        if performance_data.get('success_rate', 1.0) < 0.9:
            # Could adjust workflow parameters here
            pass
        return optimized_config

    async def _scale_team_dynamically(self, current_team, workload_metrics):
        """Dynamically scale team based on workload."""
        # Mock scaling logic
        if workload_metrics.get('queue_length', 0) > 20:
            await self._add_agent_to_team(current_team, 'additional_agent')
        return current_team

    async def _add_agent_to_team(self, team, agent_name):
        """Add an agent to the team."""
        # Mock implementation
        pass

    def _format_team_response(self, agent_responses):
        """Format final team response."""
        response_parts = []
        for response in agent_responses:
            agent_name = response.get('agent', 'Unknown')
            agent_response = response.get('response', '')
            response_parts.append(f"{agent_name}: {agent_response}")
        return "\n".join(response_parts)

    async def _monitor_team_health(self, team):
        """Monitor team health during execution."""
        return {
            'agent_count': len(team.agents) if hasattr(team, 'agents') else 0,
            'overall_status': 'healthy'
        }


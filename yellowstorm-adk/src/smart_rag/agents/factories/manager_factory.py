from typing import List, Any, Optional
from google.adk import Agent
from google.adk.agents.callback_context import CallbackContext
from google.genai import types

from src.logger.logging import get_logger
from src.smart_rag.agents.factories.delegation_factory_helper import (
    _append_connector_repo_context,
    _append_workspace_document_context,
    _get_connector_repo,
    _get_team_skills,
)
from src.skills.runtime import inject_skill_catalog, make_activate_skill_tool
from src.guardrails.adapters.google_adk import apply_guardrail_callbacks
from src.smart_rag.agents.core import DocumentHelpers
from src.smart_rag.infrastructure.processing import add_additional_context, add_timestamp_to_agent

logger = get_logger("api.routers.agentic_rag.ManagerAgentFactory")
 
class ManagerAgentFactory:
    """Creates and configures manager agents.

    This factory class handles the creation and configuration of manager agents
    that coordinate team operations, delegate tasks, and manage agent interactions.

    Attributes:
        config: Configuration object for the manager agent.
        prompt_processor: Processor for handling and formatting prompts.
        llm_factory: Factory for creating language model instances.
        agent_repository: Repository for managing agent data.
        chatbot_name (str): Name of the chatbot provider.
        agent_helper: Helper for agent-related operations.
        _tool_provider: Provider for tool descriptions and configurations.
        _context_builder: Builder for creating agent contexts.
        document_helper: Helper for document-related operations.
    """

    def __init__(self, config, prompt_processor, llm_factory, agent_repository,tool_provider,context_builder,agent_helper):
        """Initialize the ManagerAgentFactory.

        Args:
            config: Configuration object for the manager agent.
            prompt_processor: Processor for handling and formatting prompts.
            llm_factory: Factory for creating language model instances.
            agent_repository: Repository for managing agent data.
            tool_provider: Provider for tool descriptions and configurations.
            context_builder: Builder for creating agent contexts.
            agent_helper: Helper for agent-related operations.
        """
        self.config = config
        self.prompt_processor = prompt_processor
        self.llm_factory = llm_factory
        self.agent_repository = agent_repository
        self.chatbot_name = config.chatbot_name if hasattr(config, 'chatbot_name') else 'default'
        self.agent_helper = agent_helper

        self._tool_provider = tool_provider
        self._context_builder = context_builder
        self.document_helper=DocumentHelpers()

    def create_manager_agent(self, manager_prompt: str, tools: List[Any],
                             delegation_factory, manager_temperature: float, tool_choice: str = "auto",
                             manager_specific_tools: Optional[List[str]] = None) -> Any:
        """Create the manager agent with proper configuration.

        Creates and configures a manager agent with the specified prompt, tools,
        and temperature settings. The manager agent coordinates delegation to other
        agents and handles team-level operations.

        Args:
            manager_prompt (str): The prompt template for the manager agent.
            tools (List[Any]): List of delegation tools available to the manager agent.
            delegation_factory: Factory for creating delegation functions.
            manager_temperature (float): Temperature setting for the manager's LLM.
            tool_choice (str, optional): Tool choice mode ('auto', 'none', etc.).
                If 'none', the manager will not be able to delegate to agents.
            manager_specific_tools (Optional[List[str]]): List of tool names (e.g., ['dataviz'])
                that should be added directly to the manager agent.

        Returns:
            Any: Configured manager agent instance ready for execution.
        """
        # Add manager-specific tools if provided
        if manager_specific_tools:
            tools = self._add_manager_specific_tools(tools, manager_specific_tools)

        # Let the manager lazily load any conversation-level skill's full instructions.
        activate_skill_tool = make_activate_skill_tool(_get_team_skills(self.config))
        if activate_skill_tool:
            tools = tools + [activate_skill_tool]

        model = self.llm_factory.create_no_parallel_tool_calls_llm(
            self.chatbot_name,
            temperature=manager_temperature,
            tool_choice=tool_choice
        )
        manager_instruction = self._create_manager_instruction(manager_prompt)

        def check_if_agent_with_search_in_team(callback_context: CallbackContext) -> Optional[types.Content]:
            """Check if the team has agents with search capabilities.

            This callback checks if any agents in the team have search tools and
            initializes the task search order from the callback context state.

            Args:
                callback_context (CallbackContext): The callback context containing state.

            Returns:
                Optional[types.Content]: Always returns None as this is a state update callback.
            """
            callback_context.state[
                "has_search_agents"] = self.agent_repository.has_search_agents() if callback_context.state.get(
                "has_search_agents", None) is None else callback_context.state.get("has_search_agents")
            if callback_context.state.get("has_search_agents"):
                delegation_factory.task_search_order = callback_context.state.get("task_search_order", 0)
                callback_context.state["task_search_order"] = delegation_factory.task_search_order

            return None

        def add_task_order_to_state(callback_context: CallbackContext) -> Optional[types.Content]:
            """Update the callback context state with current task search order.

            This callback persists the task search order and search agents flag
            to the state so they can be retrieved in the next session.

            Args:
                callback_context (CallbackContext): The callback context to update.

            Returns:
                Optional[types.Content]: Always returns None as this is a state update callback.
            """
            # Update the state with the current task_search_order so it persists for the next session
            callback_context.state["task_search_order"] = delegation_factory.task_search_order
            callback_context.state["has_search_agents"] = self.agent_repository.has_search_agents()
            return None

        manager_config = self.agent_repository.get_agent_by_name("manager_agent") or self.agent_repository.get_agent_by_name("manager") or {}
        manager_kwargs = apply_guardrail_callbacks({
            "name": "manager_agent",
            "model": model,
            "instruction": manager_instruction+ "\n\n the current timestamp is {time}. \n",
            "tools": tools,
            "before_tool_callback": add_additional_context,
            "before_agent_callback": [check_if_agent_with_search_in_team,add_timestamp_to_agent],
            "after_agent_callback": add_task_order_to_state,
        }, {**manager_config, "user_id": getattr(self.config, "user_id", "")})
        manager_agent = Agent(**manager_kwargs)

        manager_agent._team_instance = delegation_factory
        return manager_agent

    def _create_manager_instruction(self, manager_prompt: str) -> str:
        """Create the manager instruction with all necessary context.

        Enhances the base manager prompt by extracting and cleaning the chatbot name,
        adding web search capabilities, and including document tree information
        if search agents are available in the team.

        Args:
            manager_prompt (str): The base prompt for the manager agent.

        Returns:
            str: Enhanced manager instruction with all necessary context and capabilities.
        """
        cleaned_manager_prompt, _ = self.prompt_processor.extract_chatbot_name_and_clean_prompt(manager_prompt)
        manager_instruction = cleaned_manager_prompt + self.prompt_processor.get_web_search_prompt(1) 

        if self.agent_repository.has_search_agents() or self.agent_repository.has_code_interpreter():
            # Add document tree info from all agents (without IDs) for manager context
            manager_instruction += self.document_helper._get_consolidated_document_tree_info_for_manager(self.config,self.agent_repository.get_all_agents())

        manager_instruction = _append_connector_repo_context(
            manager_instruction,
            _get_connector_repo(self.config),
        )
        manager_instruction = _append_workspace_document_context(
            manager_instruction,
            getattr(self.config, "brain_documents", None),
        )

        # Expose the conversation-level skills to the manager (catalog only; the
        # activation tool is wired in create_manager_agent).
        manager_instruction = inject_skill_catalog(
            manager_instruction,
            _get_team_skills(self.config),
        )

        # Add parallel execution instructions
        #manager_instruction += get_parallel_execution_prompt()
        #manager_instruction += get_agent_coordination_prompt()

        return manager_instruction

    def _add_manager_specific_tools(self, tools: List[Any], manager_specific_tools: List[str]) -> List[Any]:
        """Add manager-specific tools to the tools list.

        Processes the list of manager-specific tool names and adds the corresponding
        MCP toolsets to the existing delegation tools list.

        Args:
            tools (List[Any]): Existing list of delegation tools.
            manager_specific_tools (List[str]): List of tool names to add

        Returns:
            List[Any]: Updated tools list with manager-specific tools added.
        """
        from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper

        # Create a copy to avoid modifying the original list
        updated_tools = tools.copy()

        brain_ids = getattr(self.config, 'brain_ids', None)
        enable_vectorstore_mcp = False
        enable_deep_search = False

        for tool_name in manager_specific_tools:
            tool_name_lower = tool_name.lower()

            if tool_name_lower == 'deep_search':
                enable_deep_search = True
                enable_vectorstore_mcp = True

            if tool_name_lower == 'dataviz':
                # Add dataviz MCP toolset
                try:
                    mcp_configs = [{'type': 'dataviz'}]
                    dataviz_toolset = MCPHelper.create_toolsets(mcp_configs)
                    if dataviz_toolset:
                        updated_tools.extend(dataviz_toolset)
                    else:
                        logger.warning("Failed to create dataviz toolset - toolset is None")
                except Exception as e:
                    logger.exception(f"Error adding dataviz toolset to manager agent: {e}")

            elif tool_name_lower == 'formviz':
                try:
                    from src.smart_rag.tools.utilities.formviz_tools import generate_form_viz
                    updated_tools.append(generate_form_viz)
                    logger.info("Added generate_form_viz tool to manager agent")
                except Exception as e:
                    logger.exception(f"Error adding generate_form_viz tool to manager agent: {e}")

            elif tool_name_lower == 'plan':
                try:
                    from src.smart_rag.tools.utilities.plan_generator import generate_execution_plan
                    updated_tools.append(generate_execution_plan)
                    logger.info("Added generate_execution_plan tool to manager agent")
                except Exception as e:
                    logger.exception(f"Error adding generate_execution_plan tool to manager agent: {e}")

            else:
                logger.warning(f"Unknown manager-specific tool: {tool_name}. Skipping.")

        if enable_vectorstore_mcp:
            try:
                vectorstore_toolset = MCPHelper.create_vectorstore_toolsets_with_deep_search(
                    brain_ids=brain_ids,
                    deep_search=enable_deep_search,
                )
                updated_tools.extend(vectorstore_toolset)
                logger.info(
                    "Enabled vectorstore MCP toolset for manager agent (has_brain_ids=%s deep_search=%s)",
                    bool(brain_ids),
                    enable_deep_search,
                )
            except Exception as e:
                logger.exception(f"Error enabling vectorstore toolset for manager agent: {e}")

        return updated_tools

    def _get_document_tree_info(self, doc_tree, brain_tree) -> str:
        """Get formatted document tree information for inclusion in prompts.

        Delegates to the agent helper to format document and brain tree structures
        into a string representation suitable for inclusion in agent prompts.

        Args:
            doc_tree: Document tree structure containing hierarchical organization of documents.
            brain_tree: Brain tree structure containing knowledge relationships.

        Returns:
            str: Formatted string with document and brain tree information.
        """
        helper = self.agent_helper
        return helper.get_document_tree_info(doc_tree, brain_tree)

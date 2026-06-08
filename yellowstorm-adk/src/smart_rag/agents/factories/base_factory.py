"""
Agent Factory Module

Factory classes for creating different types of agents and tools with appropriate configurations.
Handles creation of agents with various tools and capabilities based on provided parameters.

Classes:
- ToolFactory: Factory class for creating various tools and toolkits.
- AgentFactory: Factory class for creating different types of agents.
"""

import copy
import json
from typing import Any, List, Optional, Tuple, Dict
from google.adk import Agent
from google.adk.tools import AgentTool
from google.adk.tools.mcp_tool import MCPToolset

from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.tools.utilities.connector_tools import (
    ConnectorToolContext,
    create_connector_tools,
)
from src.smart_rag.agents.factories.tool_factory import ToolFactory
from src.smart_rag.infrastructure.diagram.reference_tracker import (
    DiagramReferenceTracker,
)

# Global reference tracker instance
_reference_tracker = DiagramReferenceTracker()
from src.smart_rag.infrastructure.factories import LLMFactory
from src.smart_rag.infrastructure.processing import (
    PromptProcessor,
    catch_images_after_tool,
    inject_images_before_model,
    add_additional_context,
    add_timestamp_to_agent,
    catch_diagram_after_tool,
    add_diagram_context_before_tool,
)
from src.smart_rag.tools import (
    generate_brain_tree_schema,
    SearchToolkit,
    SearchToolADK,
    construct_json,
    render_chart,
)

from src.logger.logging import get_logger
from src.smart_rag.tools.utilities import calculator, python_interpreter
from src.skills.runtime import inject_skill_catalog, make_activate_skill_tool

from src.smart_rag.infrastructure.processing.sandbox_callbacks import (
    create_sandbox_callbacks,
)
from src.config.settings import get_settings

logger = get_logger("api.smart_rag.agent_factory")


class AgentFactory:
    """Factory class for creating different types of agents.
    Handles creation of agents with various tools and capabilities based on provided parameters.
    """

    def __init__(
        self,
        prompt_processor: PromptProcessor,
        llm_factory: LLMFactory,
        citation_manager=None,
    ):
        self.prompt_processor = prompt_processor
        self.llm_factory = llm_factory
        self.tool_factory = ToolFactory()
        self.citation_manager = citation_manager
        self.diagram_tool_config = {"prompt": "", "instructions": ""}

    def set_diagram_tool_config(self, diagram_tool_config: dict):
        """Set the configuration for the diagram tool.

        Args:
            diagram_tool_config (dict): Configuration dictionary for the diagram tool.
        """
        self.diagram_tool_config = diagram_tool_config

    def _create_html_diagram_tool(
        self, chatbot_name: str, instructions: Optional[str] = None
    ) -> AgentTool:
        """Create an HtmlAgent tool for diagramming.

        Args:
            chatbot_name (str): Name of the chatbot model to use

        Returns:
            AgentTool: Configured HtmlAgent tool for delegation
        """
        if not instructions:
            instructions = self.diagram_tool_config["instructions"]
        diagramming_agent = self.create_html_diagram_agent(
            instructions=instructions, chatbot_name=chatbot_name
        )

        return AgentTool(diagramming_agent, skip_summarization=False)

    @staticmethod
    def _resolve_connector_workspace_id(
        conversation_brain_id: Optional[str],
        brain_documents: Optional[list],
    ) -> Optional[str]:
        for doc in brain_documents or []:
            workspace_id = str(doc.get("workspace_id") or "").strip()
            if workspace_id:
                return workspace_id
        return conversation_brain_id

    def create_agent(
        self,
        name: str,
        prompt: str,
        chatbot_name: str,
        calculator_tool: bool = False,
        search_web_tool: bool = False,
        in_memory_tool: bool = False,
        in_memory_tool_description: Optional[str] = None,
        html_design: Optional[bool] = False,
        search_tool: bool = False,
        code_interpreter_tool: bool = False,
        snowflake_tool: bool = False,
        dataviz_tool: bool = False,
        formviz_tool: bool = False,
        skills: Optional[List[Dict]] = None,
        doc_tree: Optional[List] = None,
        brain_tree: Optional[List] = None,
        brain_ids: Optional[List[str]] = None,
        top_k: int = 10,
        vectorstore_name: str = "default",
        task_order: Optional[str] = None,
        mcp_toolset: Optional[MCPToolset] = None,
        temperature: float = 0.0,
        max_tokens: int = 20000,
        session_id: Optional[str] = None,
        brain_documents: Optional[list] = None,
        conversation_brain_id: Optional[str] = None,
        user_id: Optional[str] = None,
        connector_bindings: Optional[List[Dict[str, Any]]] = None,
    ) -> Agent:
        """Create an agent with optional tools including calculator, web search, document search, and in-memory extraction.

                     mcp_toolset: Optional[MCPToolset] = None, temperature: int = 0.0,
                     session_id: Optional[str] = None, brain_documents: Optional[list] = None) -> Agent:
        Args:
            name (str): Name of the agent.
            prompt (str): Instruction prompt for the agent.
            chatbot_name (str): Name of the chatbot model to use.
            calculator_tool (bool): Whether to include a calculator tool.
            search_web_tool (bool): Whether to include a web search tool.
            in_memory_tool (bool): Whether to include in-memory document extraction tool for accessing complete file context.
            in_memory_tool_description (Optional[str]): Custom description for the in-memory tool functionality.
            search_tool (bool): Whether to include document/brain search tools.
            doc_tree (Optional[List]): Document tree for search and in-memory tools.
            code_interpreter_tool (bool): Whether to include code interpreter (microsandbox MCP).
            brain_tree (Optional[List]): Brain tree for search tools.
            brain_ids (Optional[List[str]]): List of brain IDs for search tools.
            top_k (int): Number of top results to return in searches.
            vectorstore_name (str): Name of the vector store to use for searches.
            task_order (Optional[str]): Task order context for searches.
            mcp_toolset (Optional[MCPToolset]): MCP toolset for Excel operations.
            temperature (int): Temperature parameter for the LLM model.
            session_id (Optional[str]): Session ID for microsandbox callbacks.
            brain_documents (Optional[list]): Brain documents for microsandbox file mounting.
            conversation_brain_id (Optional[str]): Brain ID from the original user request conversation.
            html_diagram_tool (bool): Whether to include HTML diagram generation tool.
        Returns:
            Agent: Configured agent instance with the requested tools.

        Raises:
            ValueError: If search_tool is True but doc_tree or brain_ids are not provided.
            Exception: For any other errors during agent creation.

        """
        tools = []
        search_web = "standard" if search_web_tool else "off"
        prompt = inject_skill_catalog(prompt, skills)

        activate_skill_tool = make_activate_skill_tool(skills)
        if activate_skill_tool:
            tools.append(activate_skill_tool)

        # Add calculator tool if requested
        if calculator_tool:
            tools.append(calculator)

        tools.append(render_chart)

        # Add HTML diagram tool if requested
        if html_design:
            tools.append(self._create_html_diagram_tool(chatbot_name))

        # Add search tools if requested
        if search_tool and doc_tree and brain_ids:
            search_tools, _ = self.tool_factory.create_search_tools(
                doc_tree,
                brain_tree,
                brain_ids,
                top_k,
                vectorstore_name,
                task_order,
                search_web,
                citation_manager=self.citation_manager,
                user_id=user_id,
            )
            tools.extend(search_tools)

        # Add in memory tool if requested
        if in_memory_tool:
            in_memory_tools, _ = self.tool_factory.create_in_memory_tools(
                doc_tree, brain_ids, top_k, vectorstore_name, "q", task_order
            )
            tools.extend(in_memory_tools)

        # Add standalone web search tool if requested
        if search_web_tool and not (search_tool and doc_tree and brain_ids):
            toolkit = SearchToolkit(
                task_order=task_order,
                workspace_name=brain_ids or [],
                top_k=top_k,
                vectorstore=vectorstore_name,
                search_web=search_web,
            )
            tools.append(toolkit.perform_web_search)

        # Add snowflake tool if requested
        if snowflake_tool:
            mcp_configs = [{"type": "snowflake"}]
            try:
                snowflake_toolset = MCPHelper.create_toolsets(mcp_configs)
                if snowflake_toolset:
                    tools.extend(snowflake_toolset)
            except Exception as e:
                logger.exception(f"Error creating snowflake toolset: {e}")

        # Add dataviz tool if requested
        if dataviz_tool:
            mcp_configs = [{"type": "dataviz"}]
            try:
                dataviz_toolset = MCPHelper.create_toolsets(mcp_configs)
                if dataviz_toolset:
                    tools.extend(dataviz_toolset)
            except Exception as e:
                logger.exception(f"Error creating dataviz toolset: {e}")

        # Add MCP toolset if provided
        if mcp_toolset:
            tools.append(mcp_toolset)

        if connector_bindings:
            try:
                connector_workspace_id = self._resolve_connector_workspace_id(
                    conversation_brain_id,
                    brain_documents,
                )
                tools.extend(
                    create_connector_tools(
                        connector_bindings,
                        ConnectorToolContext(
                            workspace_id=connector_workspace_id,
                            brain_ids=brain_ids,
                            brain_documents=brain_documents,
                            session_id=session_id,
                        ),
                    )
                )
            except Exception as e:
                logger.exception(f"Error adding connector tools: {e}")

        # Add custom python_interpreter if code_interpreter requested
        if code_interpreter_tool:
            try:
                tools.append(python_interpreter)
                # Store code interpreter params to be injected into session state later
                _code_interpreter_state = {}
                if brain_documents:
                    _code_interpreter_state["_code_interpreter_brain_docs"] = (
                        MCPHelper.extract_minimal_fields(brain_documents)
                    )
                if session_id:
                    _code_interpreter_state["_code_interpreter_session_id"] = session_id
                if conversation_brain_id:
                    _code_interpreter_state["_code_interpreter_brain_id"] = (
                        conversation_brain_id
                    )
                if user_id:
                    _code_interpreter_state["_code_interpreter_user_id"] = user_id
                # Will be attached to the agent after creation
                self._pending_code_interpreter_state = _code_interpreter_state

                # Add available document names to prompt so code interpreter knows which files exist
                if brain_documents:
                    doc_names = [
                        doc.get("filename")
                        for doc in brain_documents
                        if isinstance(doc, dict) and doc.get("filename")
                    ]
                    if doc_names:
                        prompt += f"\n\n<available_documents>\n{json.dumps(doc_names, indent=4)}\n</available_documents>"

                logger.info(
                    "Added custom python_interpreter tool (params will be passed via session state)"
                )
            except Exception as e:
                logger.exception(f"Error adding python_interpreter tool: {e}")

        # Add generate_form_viz tool
        if formviz_tool:
            try:
                from src.smart_rag.tools.utilities.formviz_tools import (
                    generate_form_viz,
                )

                tools.append(generate_form_viz)
            except Exception as e:
                logger.exception(f"Error adding generate_form_viz tool: {e}")

        # Add diagram instructions if html diagram tool is included
        instruction = prompt
        if (
            html_design
            and self.diagram_tool_config
            and self.diagram_tool_config["instructions"]
            and self.diagram_tool_config["prompt"]
        ):
            diagram_instruction = self.diagram_tool_config["instructions"]
            instruction += self.diagram_tool_config["prompt"]

        # Use appropriate LLM based on whether tools are available
        if tools:
            model = self.llm_factory.create_parallel_tool_calls_llm(
                chatbot_name, temperature, max_completion_tokens=max_tokens
            )
        else:
            model = self.llm_factory.create_no_tool_calls_llm(
                chatbot_name, temperature, max_completion_tokens=max_tokens
            )

        # Prepare agent kwargs
        agent_kwargs = {
            "name": name,
            "model": model,
            "instruction": instruction + "\n\n the current timestamp is {time}. \n",
            "before_agent_callback": add_timestamp_to_agent,
        }

        if tools:
            agent_kwargs["tools"] = tools

        # Prepare callbacks
        after_tool_callbacks = []

        # Add diagram callbacks if html diagram tool is included
        if html_design:
            # Add before_tool_callback to inject calling agent context
            agent_kwargs["before_tool_callback"] = add_diagram_context_before_tool
            # Add after_tool_callback to catch and store diagram HTML
            after_tool_callbacks.append(catch_diagram_after_tool)

        if after_tool_callbacks:
            agent_kwargs["after_tool_callback"] = after_tool_callbacks

        agent = Agent(**agent_kwargs)

        # Attach code interpreter state to agent for session injection
        if hasattr(self, "_pending_code_interpreter_state"):
            agent._code_interpreter_state = self._pending_code_interpreter_state
            del self._pending_code_interpreter_state

        return agent

    def create_report_writer_agent(
        self, prompt: str = None, chatbot_name: str = None
    ) -> Agent:
        """Create a report writer agent.

        Args:
            prompt (str): Instruction prompt for the report writer agent.
            chatbot_name (str): Name of the chatbot model to use.
        Returns:
            Agent: Configured report writer agent instance.
        """
        report_writer_prompt, chatbot_name = (
            self.prompt_processor.extract_chatbot_name_and_clean_prompt(
                prompt, chatbot_name=chatbot_name
            )
        )

        # Use parallel tool calls LLM since we're adding the HtmlAgent tool
        model = self.llm_factory.create_parallel_tool_calls_llm(chatbot_name)

        # Add the HtmlAgent tool for diagramming
        diagramming_agent = self.create_html_diagram_agent(chatbot_name=chatbot_name)
        tools = [(AgentTool(diagramming_agent, skip_summarization=False))]

        return Agent(
            name="ReportWriterAgent",
            model=model,
            instruction=report_writer_prompt
            + "\n\n the current timestamp is {time}. \n",
            tools=tools,
            before_agent_callback=add_timestamp_to_agent,
            before_tool_callback=add_diagram_context_before_tool,
            after_tool_callback=catch_diagram_after_tool,
        )

    def create_html_agent(
        self,
        prompt: str = None,
        chatbot_name: str = None,
        tools: Optional[list] = None,
        name: Optional[str] = "HtmlAgent",
        max_tokens: int = 30000,
    ) -> Agent:
        """Create a visualizer agent capable of generating HTML.
        Args:
            prompt (str): Instruction prompt for the HTML agent.
            chatbot_name (str): Name of the chatbot model to use.
            tools (Optional[list]): List of tools to include with the agent.
            name (Optional[str]): Name of the agent. Defaults to "HtmlAgent".
            max_tokens (int): Maximum tokens for the model response. Defaults to 30000.
        Returns:
            Agent: Configured HTML agent instance.

        """
        html_prompt, chatbot_name = (
            self.prompt_processor.extract_chatbot_name_and_clean_prompt(
                prompt, chatbot_name
            )
        )

        if not tools:
            model = self.llm_factory.create_no_tool_calls_llm(
                chatbot_name, max_completion_tokens=max_tokens
            )
            return Agent(
                name=name,
                model=model,
                instruction=html_prompt + "\n\n the current timestamp is {time}. \n",
                before_agent_callback=add_timestamp_to_agent,
            )
        else:
            model = self.llm_factory.create_parallel_tool_calls_llm(
                chatbot_name, max_completion_tokens=max_tokens
            )
            return Agent(
                name=name,
                model=model,
                instruction=html_prompt + "\n\n the current timestamp is {time}. \n",
                tools=tools,
                before_agent_callback=add_timestamp_to_agent,
            )

    def create_operator_agent(
        self,
        prompt: str = None,
        chatbot_name: str = None,
        user_id: Optional[str] = None,
        brain_ids: Optional[list] = None,
        session_id: Optional[str] = None,
        brain_documents: Optional[list] = None,
    ) -> Agent:
        """Create an operator agent with calculator and python_interpreter tools.

        Args:
            prompt (str): Instruction prompt for the operator agent.
            chatbot_name (str): Name of the chatbot model to use.
            user_id (Optional[str]): User ID (not used currently).
            brain_ids (Optional[list]): Brain IDs for python_interpreter context.
            session_id (Optional[str]): Session ID for python_interpreter context.
            brain_documents (Optional[list]): Brain documents for python_interpreter file mounting.
        Returns:
            Agent: Configured operator agent instance.
        """
        operator_agent_prompt, chatbot_name = (
            self.prompt_processor.extract_chatbot_name_and_clean_prompt(
                prompt, chatbot_name
            )
        )
        model = self.llm_factory.create_parallel_tool_calls_llm(chatbot_name)
        tools = [calculator]

        # Add custom python_interpreter (code interpreter tool)
        _code_interpreter_state = {}
        try:
            if brain_documents:
                _code_interpreter_state["_code_interpreter_brain_docs"] = (
                    MCPHelper.extract_minimal_fields(brain_documents)
                )
            if session_id:
                _code_interpreter_state["_code_interpreter_session_id"] = session_id
            if brain_ids and len(brain_ids) > 0:
                _code_interpreter_state["_code_interpreter_brain_id"] = brain_ids[0]

            tools.append(python_interpreter)
            logger.info(
                "Added custom python_interpreter tool to operator agent (params will be passed via session state)"
            )
        except Exception as e:
            logger.exception(
                f"Error adding python_interpreter tool to operator agent: {e}"
            )

        # Create agent
        agent_kwargs = {
            "name": "OperatorAgent",
            "model": model,
            "instruction": operator_agent_prompt
            + "\n\n the current timestamp is {time}.",
            "tools": tools,
            "before_agent_callback": add_timestamp_to_agent,
        }

        agent = Agent(**agent_kwargs)

        # Attach code interpreter state to agent for session injection
        if _code_interpreter_state:
            agent._code_interpreter_state = _code_interpreter_state

        return agent

    def create_search_agent(
        self,
        doc_tree: Optional[List],
        brain_tree: Optional[List],
        brain_ids: List[str],
        vectorstore_name: str,
        search_web: str = "off",
        snowflake_tool: bool = False,
        dataviz_tool: bool = False,
        formviz_tool: bool = False,
        prompt: str = None,
        task_order: Optional[str] = None,
        chatbot_name: str = None,
        name: str = "SearchAgent",
        temperature: float = 0,
        max_tokens=20000,
        top_k: int = 1,
        citation_manager=None,
        user_id: Optional[str] = None,
    ) -> Tuple[Agent, SearchToolkit, str]:
        """Create a search agent with appropriate tools."""
        tools, toolkit = self.tool_factory.create_search_tools(
            doc_tree,
            brain_tree,
            brain_ids,
            top_k,
            vectorstore_name,
            task_order,
            search_web,
            citation_manager=citation_manager,
            user_id=user_id,
        )

        tree_info = ""
        if doc_tree:
            _, _, tree = construct_json(copy.deepcopy(doc_tree))
            tree_info += f"\n\n< documents_tree >\n{json.dumps(tree, indent=4)}\n</ documents_tree >"

        if brain_tree:
            _, _, brain_tree_obj = generate_brain_tree_schema(copy.deepcopy(brain_tree))
            tree_info += f"\n\n< brain_tree >\n{json.dumps(brain_tree_obj, indent=4)}\n< /brain_tree >"

        search_agent_prompt, chatbot_name = (
            self.prompt_processor.extract_chatbot_name_and_clean_prompt(
                prompt, chatbot_name
            )
        )

        # Use appropriate LLM based on whether tools are available
        if tools:
            model = self.llm_factory.create_parallel_tool_calls_llm(
                chatbot_name, temperature=temperature, max_completion_tokens=max_tokens
            )
        else:
            model = self.llm_factory.create_no_tool_calls_llm(
                chatbot_name, temperature=temperature, max_completion_tokens=max_tokens
            )

        web_search_prompt_index = 4 if search_web != "off" else 3
        web_search_prompt = self.prompt_processor.get_web_search_prompt(
            web_search_prompt_index
        )
        instruction = str(search_agent_prompt) + str(web_search_prompt) + str(tree_info)

        # Add perform_standard_search if we have a toolkit
        if toolkit:
            standard_search_schema = {
                "name": "perform_standard_search",
                "strict": True,
                "description": "Standard Search: Retrieves information from all available documents at once. Use this function when the user query is ambiguous and you aren't sure which document to search.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query string",
                        }
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            }

            standard_search_wrapper, standard_tool_schema = toolkit.generate_function(
                standard_search_schema, toolkit.perform_standard_search
            )
            standard_search_tool = SearchToolADK(
                func=standard_search_wrapper, schema=standard_tool_schema
            )
            tools.append(standard_search_tool)
        # Add snowflake tool if requested
        if snowflake_tool:
            mcp_configs = [{"type": "snowflake"}]
            try:
                snowflake_toolset = MCPHelper.create_toolsets(mcp_configs)
                if snowflake_toolset:
                    tools.extend(snowflake_toolset)
            except Exception as e:
                logger.exception(f"Error creating snowflake toolset: {e}")

        # Add dataviz tool if requested
        if dataviz_tool:
            mcp_configs = [{"type": "dataviz"}]
            try:
                dataviz_toolset = MCPHelper.create_toolsets(mcp_configs)
                if dataviz_toolset:
                    tools.extend(dataviz_toolset)
            except Exception as e:
                logger.exception(f"Error creating dataviz toolset: {e}")

        # Add formviz tool if requested
        if formviz_tool:
            try:
                from src.smart_rag.tools.utilities.formviz_tools import (
                    generate_form_viz,
                )

                tools.append(generate_form_viz)
            except Exception as e:
                logger.exception(f"Error adding generate_form_viz tool: {e}")

        return (
            Agent(
                name=name,
                model=model,
                instruction=instruction + "\n\n the current timestamp is {time}. \n",
                tools=tools,
                before_agent_callback=add_timestamp_to_agent,
                after_tool_callback=[catch_images_after_tool],
                before_model_callback=inject_images_before_model,
            ),
            toolkit,
            instruction,
        )

    def create_html_diagram_agent(
        self,
        instructions: str = None,
        chatbot_name: str = None,
        name: Optional[str] = "HtmlAgent",
    ) -> Agent:
        """Create a visualizer agent capable of generating HTML.
        Args:
            prompt (str): Instruction prompt for HTML agent.
            chatbot_name (str): Name of chatbot model to use.
            tools (Optional[list]): List of tools to include with agent.
            name (Optional[str]): Name of Agent. Defaults to "HtmlAgent".
        Returns:
            Agent: Configured HTML agent instance.
        """
        if not instructions:
            instructions = self.diagram_tool_config["instructions"]

        model = self.llm_factory.create_no_tool_calls_llm(chatbot_name)
        return Agent(
            name=name,
            model=model,
            instruction=instructions + "\n\nCurrent timestamp is {time}. \n",
            before_agent_callback=add_timestamp_to_agent,
        )

    def create_manager_agent(
        self, prompt: str, chatbot_name: str, tools: List
    ) -> Agent:
        """Create a manager agent with delegation tools.

        Args:
            prompt: Instruction prompt for the manager agent
            chatbot_name: Name of the chatbot model to use
            tools: List of delegation tools for the agent

        Returns:
            Configured manager agent instance
        """
        cleaned_manager_prompt, chatbot_name = (
            self.prompt_processor.extract_chatbot_name_and_clean_prompt(
                prompt, chatbot_name
            )
        )
        model = self.llm_factory.create_no_parallel_tool_calls_llm(chatbot_name)

        return Agent(
            name="manager_agent",
            model=model,
            instruction=cleaned_manager_prompt
            + "\n\n the current timestamp is {time}. \n",
            tools=tools,
            before_agent_callback=add_timestamp_to_agent,
            before_tool_callback=add_additional_context,
        )

    def create_tools_for_agent(
        self,
        doc_tree: Optional[List],
        brain_tree: Optional[List],
        brain_ids: List[str],
        top_k: int,
        vectorstore_name: str,
        task_order: Optional[str] = None,
        calculator_tool: bool = False,
        search_tool: bool = False,
        search_web_tool: bool = False,
    ) -> List:
        """Create tools for agents based on specified requirements."""
        return self.tool_factory.create_tools_for_agent(
            doc_tree,
            brain_tree,
            brain_ids,
            top_k,
            vectorstore_name,
            task_order,
            calculator_tool,
            search_tool,
            search_web_tool,
        )

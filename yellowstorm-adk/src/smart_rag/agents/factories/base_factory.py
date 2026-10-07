"""Agent factory module.

Consolidates all ADK agent-wiring factories:
- ToolFactory: search/in-memory/config-driven tool creation.
- AgentFactory: general agent creation (tools, skills, guardrails, context injection).
- ManagerAgentFactory: team manager agent creation and instruction building.

Delegation-time helpers and AgentDelegationFactory live in delegation_factory.
"""

import copy
import json
from typing import Any, Dict, List, Optional, Tuple, Union

from google.adk import Agent
from google.adk.agents.callback_context import CallbackContext
from google.adk.tools import AgentTool
from google.adk.tools.mcp_tool import MCPToolset
from google.genai import types

from src.logger.logging import get_logger
from src.config.settings import get_settings

from src.smart_rag.tools import (
    SearchToolkit,
    SearchToolADK,
    calculator,
    construct_json,
    csrd_json,
    generate_brain_tree_schema,
    in_memory_construct_json,
    render_chart,
)
from src.smart_rag.tools.utilities import python_interpreter
from src.smart_rag.tools.utilities.tool_utils import extract_tool_names
from src.smart_rag.tools.native_tool_registry import resolve_native_tools
from src.smart_rag.agents.tools.tool_configuration import (
    ToolConfigurationManager,
    ToolConfig,
    AgentParameters,
)
from src.smart_rag.tools.utilities.connector_tools import (
    ConnectorToolContext,
    create_connector_tools,
)
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.infrastructure.external.purpose_aware_mcp import PurposeAwareMcpTool
from src.smart_rag.infrastructure.factories import LLMFactory
from src.smart_rag.infrastructure.processing import (
    PromptProcessor,
    catch_images_after_tool,
    inject_images_before_model,
    add_additional_context,
    add_timestamp_to_agent,
    catch_diagram_after_tool,
    add_diagram_context_before_tool,
    prepare_web_preview_after_tool,
)
from src.skills.runtime import inject_skill_catalog, make_activate_skill_tool
from src.guardrails.adapters.google_adk import build_guarded_adk_agent
from src.smart_rag.agents.core import DocumentHelpers
from src.smart_rag.agents.factories.delegation_factory import (
    _append_connector_repo_context,
    _append_selected_workspace_context,
    _append_workspace_document_context,
    _get_connector_repo,
    _get_team_skills,
    document_tree_injection_enabled,
)

settings = get_settings()
logger = get_logger("api.smart_rag.agent_factory")
_tool_logger = get_logger("api.routers.agentic_rag.ToolFactory")
_manager_logger = get_logger("api.routers.agentic_rag.ManagerAgentFactory")


class ToolFactory:
    """Factory class for creating various tools and toolkits."""

    def __init__(self):
        self.config_manager = ToolConfigurationManager()

    # Use the utility function to avoid circular imports
    _extract_tool_names = staticmethod(extract_tool_names)

    def create_in_memory_tools(self, doc_tree: Optional[List],
                            brain_ids: List[str], top_k: int, vectorstore_name: str, in_memory_tool_description:str,
                            task_order: Optional[str] = None) -> Tuple[
        List, Optional[SearchToolkit]]:
        """Create in-memory tools based on document configurations."""
        tools = []
        toolkit = None

        try:
            original_doc_tree = copy.deepcopy(doc_tree) if doc_tree else None
            # Handle in-memory documents
            inmemory_schema, inmemory_attribute_mapping, in_memory_documents = None, None, None
            if original_doc_tree:
                inmemory_schema, inmemory_attribute_mapping, in_memory_documents = in_memory_construct_json(
                    original_doc_tree, in_memory_tool_description)

            # Create toolkit and in-memory tool if schema exists
            if inmemory_attribute_mapping and inmemory_schema:
                toolkit = SearchToolkit(
                    task_order=task_order, workspace_name=brain_ids, top_k=top_k,
                    vectorstore=vectorstore_name, search_web="off",
                )
                toolkit.set_in_memory_documents(original_doc_tree)

                in_memory_wrapper, in_memory_tool_schema = toolkit.generate_function(
                    inmemory_schema,
                    toolkit.perform_in_memory_extraction
                )
                in_memory_tool = SearchToolADK(func=in_memory_wrapper, schema=in_memory_tool_schema)
                tools.append(in_memory_tool)

            return tools, toolkit

        except Exception as e:
            _tool_logger.exception(f"error while creating in-memory tools: {e}")
            return [], None


    def create_search_tools(self, doc_tree: Optional[List], brain_tree: Optional[List],
                            brain_ids: List[str], top_k: int, vectorstore_name: str,
                            task_order: Optional[str] = None, search_web: str = "off",
                            citation_manager=None,
                            user_id: Optional[str] = None) -> Tuple[
        List, Optional[SearchToolkit]]:
        """Create search tools based on document and brain configurations."""
        tools = []
        toolkit = None

        brain_tree = brain_tree if brain_tree else None
        original_doc_tree = copy.deepcopy(doc_tree) if doc_tree else None
        doc_tree_copy = doc_tree if doc_tree else None

        if doc_tree_copy:
            schema, attribute_mapping, tree = construct_json(doc_tree_copy)
        else:
            schema, attribute_mapping, tree = None, None, None

        if brain_tree:
            brain_schema, brain_attribute_mapping, brain_tree = generate_brain_tree_schema(brain_tree)
        else:
            brain_schema, brain_attribute_mapping, brain_tree = None, None, None

        if attribute_mapping and brain_attribute_mapping:
            toolkit = SearchToolkit(
                task_order=task_order, workspace_name=brain_ids, top_k=top_k,
                vectorstore=vectorstore_name, attribute_mapping=attribute_mapping,
                brain_attribute_mapping=brain_attribute_mapping, search_web=search_web,
                citation_manager=citation_manager, user_id=user_id
            )

            search_wrapper, tool_schema = toolkit.generate_function(schema, toolkit.perform_document_search)
            brain_search_wrapper, brain_tool_schema = toolkit.generate_function(brain_schema,
                                                                                toolkit.preform_all_brain_search)
            search_tool = SearchToolADK(func=search_wrapper, schema=tool_schema)
            brain_search_tool = SearchToolADK(func=brain_search_wrapper, schema=brain_tool_schema)
            tools = [brain_search_tool, search_tool, toolkit.perform_web_search] if search_web else [search_tool,
                                                                                                     brain_search_tool]

        elif attribute_mapping:
            toolkit = SearchToolkit(
                task_order=task_order, workspace_name=brain_ids, top_k=top_k,
                vectorstore=vectorstore_name, attribute_mapping=attribute_mapping, search_web=search_web,
                citation_manager=citation_manager, user_id=user_id
            )
            search_wrapper, tool_schema = toolkit.generate_function(schema, toolkit.perform_document_search)
            search_tool = SearchToolADK(func=search_wrapper, schema=tool_schema)
            tools = [search_tool, toolkit.perform_web_search] if search_web != "off" else [search_tool]

        elif brain_attribute_mapping:
            toolkit = SearchToolkit(
                task_order=task_order, workspace_name=brain_ids, top_k=top_k,
                vectorstore=vectorstore_name, brain_attribute_mapping=brain_attribute_mapping, search_web=search_web,
                citation_manager=citation_manager, user_id=user_id
            )
            brain_search_wrapper, brain_tool_schema = toolkit.generate_function(brain_schema,
                                                                                toolkit.preform_all_brain_search)
            brain_search_tool = SearchToolADK(func=brain_search_wrapper, schema=brain_tool_schema)
            tools = [brain_search_tool, toolkit.perform_web_search] if search_web != "off" else [brain_search_tool]

        # Fallback case: when no documents or brain data, but web search is enabled
        elif search_web != "off":
            toolkit = SearchToolkit(
                task_order=task_order, workspace_name=brain_ids, top_k=top_k,
                vectorstore=vectorstore_name, search_web=search_web,
                citation_manager=citation_manager, user_id=user_id
            )
            tools = [toolkit.perform_web_search]

        if toolkit is not None and settings.CSRD_BRAIN_ID in brain_ids:
            # Generate CSRD search function wrapper
            csrd_wrapper, csrd_tool_schema = toolkit.generate_search_function(
                csrd_json(),
                toolkit.perform_csrd_search
            )
            # Create CSRD search tool
            csrd_tool = SearchToolADK(func=csrd_wrapper, schema=csrd_tool_schema)
            tools.append(csrd_tool)

        return tools, toolkit

    def create_tools_for_agent(self, doc_tree: Optional[List], brain_tree: Optional[List],
                               brain_ids: List[str], top_k: int, vectorstore_name: str,
                               task_order: Optional[str] = None,
                               calculator_tool: bool = False, search_tool: bool = False,
                               search_web_tool: bool = False) -> List:
        """Create tools for agents based on specified requirements."""
        tools = []
        search_web = "standard" if search_web_tool else "off"

        # Add calculator tool if requested
        if calculator_tool:
            tools.append(calculator)

        # Handle search tools
        if search_tool and doc_tree and brain_ids:
            search_tools, _ = self.create_search_tools(
                doc_tree, brain_tree, brain_ids, top_k, vectorstore_name, task_order, search_web
            )
            tools.extend(search_tools)

        # Add standalone web search tool if requested (without document search)
        elif search_web_tool and not search_tool:
            toolkit = SearchToolkit(
                task_order=task_order, workspace_name=brain_ids or [], top_k=top_k,
                vectorstore=vectorstore_name, search_web=search_web
            )
            tools.append(toolkit.perform_web_search)

        return tools


    def create_tools_from_config(self,
                                tool_configs: Union[List[Dict[str, Any]], List[str]],
                                doc_tree: Optional[List] = None,
                                brain_tree: Optional[List] = None,
                                brain_ids: Optional[List[str]] = None,
                                vectorstore_name: str = "default",
                                task_order: Optional[str] = None,
                                default_agent_params: Optional[Dict[str, Any]] = None) -> Tuple[List[Any], Dict[str, ToolConfig]]:
        """Create tools from a flexible list of tool names or config dicts.

        Returns:
            Tuple of (created_tools, tool_config_dict).
        """
        if not tool_configs:
            _tool_logger.warning("No tool configurations provided")
            return [], {}

        try:
            # Process configurations
            processed_configs = self.config_manager.process_tool_configs(
                tool_configs,
                default_agent_params=default_agent_params
            )
            _tool_logger.debug(f"Processed {len(processed_configs)} tool configurations")
        except Exception as e:
            _tool_logger.error(f"Error processing tool configurations: {e}")
            return [], {}

        # Apply global agent params if provided
        if default_agent_params:
            processed_configs = self.config_manager.apply_global_agent_params(
                processed_configs, default_agent_params
            )

        tools = []
        config_dict = {}

        # Group configs by type for efficient processing
        grouped_configs = self.config_manager.group_by_type(processed_configs)

        # Process search tools
        if 'search' in grouped_configs or 'web_search' in grouped_configs:
            search_configs = grouped_configs.get('search', []) + grouped_configs.get('web_search', [])
            search_tools, search_toolkit = self._create_search_tools_from_config(
                search_configs, doc_tree, brain_tree, brain_ids or [],
                vectorstore_name, task_order
            )
            tools.extend(search_tools)

            # Store search toolkit configs
            for config in search_configs:
                config_dict[config.name] = config

        # Process calculator tools
        if 'calculator' in grouped_configs:
            calc_configs = grouped_configs['calculator']
            for config in calc_configs:
                if config.enabled:
                    tools.append(calculator)
                    config_dict[config.name] = config

        # Process native and custom tools.
        for tool_type, configs in grouped_configs.items():
            if tool_type not in ['search', 'web_search', 'calculator']:
                for config in configs:
                    native_tools = resolve_native_tools(
                        [config], runtime_context=default_agent_params
                    )
                    if native_tools:
                        tools.extend(native_tools)
                    elif config.enabled:
                        _tool_logger.warning(f"No native implementation registered for assigned tool '{config.name}'")
                    config_dict[config.name] = config

        _tool_logger.info(f"Created {len(tools)} tools from {len(processed_configs)} configurations")
        return tools, config_dict

    def _create_search_tools_from_config(self,
                                       search_configs: List[ToolConfig],
                                       doc_tree: Optional[List],
                                       brain_tree: Optional[List],
                                       brain_ids: List[str],
                                       vectorstore_name: str,
                                       task_order: Optional[str]) -> Tuple[List[Any], Optional[SearchToolkit]]:
        """Create search tools from configurations."""
        if not search_configs:
            return [], None

        # Use the highest top_k from configurations, with fallback to default
        top_k_values = []
        for config in search_configs:
            if hasattr(config, 'top_k'):
                top_k_values.append(config.top_k)
            else:
                top_k_values.append(4)  # Default value
        max_top_k = max(top_k_values) if top_k_values else 4

        # Determine if web search is needed
        has_web_search = any(config.name == 'web_search' or config.tool_type == 'web_search'
                           for config in search_configs)
        search_web = "standard" if has_web_search else "off"

        # Create search tools using existing method with custom top_k
        tools, toolkit = self.create_search_tools(
            doc_tree=doc_tree,
            brain_tree=brain_tree,
            brain_ids=brain_ids,
            top_k=max_top_k,
            vectorstore_name=vectorstore_name,
            task_order=task_order,
            search_web=search_web
        )

        return tools, toolkit

    def get_agent_params_from_configs(self, config_dict: Dict[str, ToolConfig]) -> Dict[str, Dict[str, Any]]:
        """Extract agent parameters from tool configurations."""
        agent_params = {}

        for tool_name, config in config_dict.items():
            if config.agent_params:
                agent_params[tool_name] = {
                    'temperature': config.agent_params.temperature,
                    'max_tokens': config.agent_params.max_tokens
                }

        return agent_params

    def update_tool_config(self, config_dict: Dict[str, ToolConfig],
                          tool_name: str, updates: Dict[str, Any]) -> bool:
        """Update a specific tool configuration."""
        if tool_name not in config_dict:
            _tool_logger.error(f"Tool '{tool_name}' not found in configuration")
            return False

        config = config_dict[tool_name]

        for key, value in updates.items():
            if key in ['temperature', 'max_tokens']:
                if not config.agent_params:
                    config.agent_params = AgentParameters()
                setattr(config.agent_params, key, value)
            elif hasattr(config, key):
                setattr(config, key, value)
            else:
                config.custom_params[key] = value

        _tool_logger.info(f"Updated tool configuration for '{tool_name}'")
        return True


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
        self.web_preview_tool_config = {
            "prompt": "",
            "instructions": "Generate a complete, self-contained HTML document for the requested preview.",
            "description": "Generate an interactive HTML preview for the user.",
        }
        self._guardrail_config: dict[str, Any] = {}

    def set_guardrail_config(self, agent_config: dict[str, Any] | None) -> None:
        self._guardrail_config = copy.deepcopy(agent_config or {})

    def _build_agent(self, agent_kwargs: dict[str, Any]) -> Agent:
        return build_guarded_adk_agent(Agent, agent_kwargs, self._guardrail_config)

    def set_diagram_tool_config(self, diagram_tool_config: dict):
        """Set the configuration for the diagram tool."""
        self.diagram_tool_config = diagram_tool_config

    def set_web_preview_tool_config(self, tool_config: dict):
        self.web_preview_tool_config.update(tool_config)

    def _create_html_diagram_tool(
        self, chatbot_name: str, instructions: Optional[str] = None, temperature: Optional[float] = 0.0
    ) -> AgentTool:
        """Create an HtmlAgent tool for diagramming."""
        if not instructions:
            instructions = self.diagram_tool_config["instructions"]
        diagramming_agent = self.create_html_diagram_agent(
            instructions=instructions, chatbot_name=chatbot_name, temperature=temperature
        )

        return AgentTool(diagramming_agent, skip_summarization=False)

    def create_web_preview_tool(
        self, chatbot_name: str, temperature: Optional[float] = 0.0
    ) -> PurposeAwareMcpTool:
        preview_agent = self.create_html_diagram_agent(
            instructions=self.web_preview_tool_config["instructions"],
            chatbot_name=chatbot_name,
            name="generate_web_preview",
            description=self.web_preview_tool_config["description"],
            temperature=temperature,
            num_retries=0,
        )
        return PurposeAwareMcpTool(AgentTool(preview_agent, skip_summarization=False))

    @staticmethod
    def _append_formviz_tool(tools: list) -> None:
        """Append the generate_form_viz tool, logging failures instead of raising."""
        try:
            from src.smart_rag.tools.utilities.formviz_tools import (
                generate_form_viz,
            )

            tools.append(generate_form_viz)
        except Exception as e:
            logger.exception(f"Error adding generate_form_viz tool: {e}")

    @staticmethod
    def _resolve_connector_workspace_id(
        conversation_brain_id: Optional[str],
        brain_documents: Optional[list],
    ) -> Optional[str]:
        selected_workspace_id = str(conversation_brain_id or "").strip()
        if selected_workspace_id:
            return selected_workspace_id
        for doc in brain_documents or []:
            workspace_id = str(doc.get("workspace_id") or "").strip()
            if workspace_id:
                return workspace_id
        return None

    def create_agent(
        self,
        name: str,
        prompt: str,
        chatbot_name: str,
        calculator_tool: bool = False,
        render_chart_tool: bool = False,
        search_web_tool: bool = False,
        in_memory_tool: bool = False,
        in_memory_tool_description: Optional[str] = None,
        html_design: Optional[bool] = False,
        generate_web_preview: bool = False,
        search_tool: bool = False,
        code_interpreter_tool: bool = False,
        formviz_tool: bool = False,
        skills: Optional[List[Dict]] = None,
        doc_tree: Optional[List] = None,
        brain_tree: Optional[List] = None,
        brain_ids: Optional[List[str]] = None,
        top_k: int = 10,
        vectorstore_name: str = "default",
        task_order: Optional[str] = None,
        mcp_toolset: Optional[MCPToolset] = None,
        temperature: Optional[float] = 0.0,
        max_tokens: int = 20000,
        session_id: Optional[str] = None,
        brain_documents: Optional[list] = None,
        file_names: Optional[List[str]] = None,
        conversation_brain_id: Optional[str] = None,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        connector_bindings: Optional[List[Dict[str, Any]]] = None,
        platform_api_token: Optional[str] = None,
        document_tree_injection_enabled: bool = True,
    ) -> Agent:
        """Create an agent with the requested tools, skills, guardrails and context injection.

        Raises:
            ValueError: If search_tool is True but doc_tree or brain_ids are not provided.
        """
        tools = []
        search_web = "standard" if search_web_tool else "off"
        prompt = inject_skill_catalog(prompt, skills)

        if document_tree_injection_enabled:
            if doc_tree:
                _, _, tree = construct_json(copy.deepcopy(doc_tree))
                prompt += f"\n\n< documents_tree >\n{json.dumps(tree, indent=4)}\n</ documents_tree >"
            if brain_tree:
                _, _, brain_tree_obj = generate_brain_tree_schema(copy.deepcopy(brain_tree))
                prompt += f"\n\n< brain_tree >\n{json.dumps(brain_tree_obj, indent=4)}\n</ brain_tree >"

        activate_skill_tool = make_activate_skill_tool(skills)
        if activate_skill_tool:
            tools.append(activate_skill_tool)

        # Add calculator tool if requested
        if calculator_tool:
            tools.append(calculator)

        if render_chart_tool:
            tools.append(render_chart)

        # Add HTML diagram tool if requested
        if html_design:
            tools.append(self._create_html_diagram_tool(chatbot_name, temperature=temperature))

        if generate_web_preview:
            tools.append(self.create_web_preview_tool(chatbot_name, temperature=temperature))

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
                            file_names=file_names,
                            session_id=session_id,
                            agent_id=agent_id,
                            user_id=user_id,
                            platform_api_token=platform_api_token,
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

        if formviz_tool:
            self._append_formviz_tool(tools)

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
        if generate_web_preview and self.web_preview_tool_config["prompt"]:
            instruction += self.web_preview_tool_config["prompt"]

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

        if generate_web_preview:
            agent_kwargs["before_tool_callback"] = add_diagram_context_before_tool
            after_tool_callbacks.append(prepare_web_preview_after_tool)

        if connector_bindings:
            after_tool_callbacks.append(catch_images_after_tool)
            agent_kwargs["before_model_callback"] = inject_images_before_model

        if after_tool_callbacks:
            agent_kwargs["after_tool_callback"] = after_tool_callbacks

        agent = self._build_agent(agent_kwargs)

        # Attach code interpreter state to agent for session injection
        if hasattr(self, "_pending_code_interpreter_state"):
            agent._code_interpreter_state = self._pending_code_interpreter_state
            del self._pending_code_interpreter_state

        return agent

    def create_report_writer_agent(
        self, prompt: str = None, chatbot_name: str = None
    ) -> Agent:
        """Create a report writer agent with an HTML diagram tool attached."""
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

        return self._build_agent({
            "name": "ReportWriterAgent",
            "model": model,
            "instruction": report_writer_prompt + "\n\n the current timestamp is {time}. \n",
            "tools": tools,
            "before_agent_callback": add_timestamp_to_agent,
            "before_tool_callback": add_diagram_context_before_tool,
            "after_tool_callback": catch_diagram_after_tool,
        })

    def create_html_agent(
        self,
        prompt: str = None,
        chatbot_name: str = None,
        tools: Optional[list] = None,
        name: Optional[str] = "HtmlAgent",
        max_tokens: int = 30000,
    ) -> Agent:
        """Create a visualizer agent capable of generating HTML."""
        html_prompt, chatbot_name = (
            self.prompt_processor.extract_chatbot_name_and_clean_prompt(
                prompt, chatbot_name
            )
        )

        if not tools:
            model = self.llm_factory.create_no_tool_calls_llm(
                chatbot_name, max_completion_tokens=max_tokens
            )
            return self._build_agent({
                "name": name,
                "model": model,
                "instruction": html_prompt + "\n\n the current timestamp is {time}. \n",
                "before_agent_callback": add_timestamp_to_agent,
            })
        else:
            model = self.llm_factory.create_parallel_tool_calls_llm(
                chatbot_name, max_completion_tokens=max_tokens
            )
            return self._build_agent({
                "name": name,
                "model": model,
                "instruction": html_prompt + "\n\n the current timestamp is {time}. \n",
                "tools": tools,
                "before_agent_callback": add_timestamp_to_agent,
            })

    def create_operator_agent(
        self,
        prompt: str = None,
        chatbot_name: str = None,
        user_id: Optional[str] = None,
        brain_ids: Optional[list] = None,
        session_id: Optional[str] = None,
        brain_documents: Optional[list] = None,
    ) -> Agent:
        """Create an operator agent with calculator and python_interpreter tools."""
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

        agent = self._build_agent(agent_kwargs)

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
        vectorstore_mcp_tool: bool = False,
        logical_search_only: bool = False,
        deep_search: bool = False,
        render_chart_tool: bool = False,
        generate_web_preview: bool = False,
        skills: Optional[List[Dict]] = None,
        document_tree_injection_enabled: bool = True,
    ) -> Tuple[Agent, SearchToolkit, str]:
        """Create a search agent with appropriate tools."""
        if logical_search_only:
            tools, toolkit = [], None
        else:
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

        if render_chart_tool:
            tools.append(render_chart)

        if generate_web_preview:
            tools.append(self.create_web_preview_tool(chatbot_name, temperature=temperature))

        tree_info = ""
        if document_tree_injection_enabled and doc_tree:
            _, _, tree = construct_json(copy.deepcopy(doc_tree))
            tree_info += f"\n\n< documents_tree >\n{json.dumps(tree, indent=4)}\n</ documents_tree >"

        if document_tree_injection_enabled and brain_tree:
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
        instruction = inject_skill_catalog(
            str(search_agent_prompt) + str(web_search_prompt) + str(tree_info),
            skills,
        )
        if generate_web_preview and self.web_preview_tool_config["prompt"]:
            instruction += self.web_preview_tool_config["prompt"]
        activate_skill_tool = make_activate_skill_tool(skills)
        if activate_skill_tool:
            tools.append(activate_skill_tool)

        if deep_search:
            deep_search_workspaces = ", ".join(
                str(workspace_id)
                for workspace_id in (brain_ids or [])
                if workspace_id
            )
            instruction += (
                "\n\n<deep_search_mode>\n"
                "You are in DEEP SEARCH mode. You MUST follow this two-phase search strategy:\n\n"
                "Phase 1 — Find relevant documents:\n"
                "- Call search_relevant_documents FIRST.\n"
                "- Pass the latest user message verbatim as the query argument; do not summarize or rewrite it.\n"
                f"- Set workspace_name to the active workspace identifier: {deep_search_workspaces}\n"
                "- This returns top candidate documents with: document_id, file_name, hybrid_score, matched concepts\n"
                "- Use the results to identify the most relevant documents for the user's question\n\n"
                "Phase 2 — Extract detailed information:\n"
                "- Using the file_name from Phase 1 results, call search_sections() or read_section()\n"
                "  to get detailed content from those specific documents\n"
                "- Cross-reference information across multiple documents when relevant\n"
                "- Use matched_hl_concepts and matched_ll_concepts to guide follow-up searches\n\n"
                "IMPORTANT: Always start with search_relevant_documents before using other search tools.\n"
                "This ensures you find the most semantically relevant documents across the entire workspace first,\n"
                "then dive deep into those specific documents for detailed answers.\n"
                "</deep_search_mode>"
            )

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

        if formviz_tool:
            self._append_formviz_tool(tools)

        if vectorstore_mcp_tool and brain_ids:
            try:
                vectorstore_toolset = MCPHelper.create_vectorstore_toolsets_with_deep_search(
                    brain_ids=brain_ids,
                    deep_search=deep_search,
                )
                if vectorstore_toolset:
                    tools.extend(vectorstore_toolset)
                    logger.info(
                        "Auto-enabled vectorstore MCP toolset with brain_ids=%s deep_search=%s",
                        brain_ids,
                        deep_search,
                    )
            except Exception as e:
                logger.exception(f"Error auto-enabling vectorstore toolset: {e}")

        agent_kwargs = {
            "name": name,
            "model": model,
            "instruction": instruction + "\n\n the current timestamp is {time}. \n",
            "tools": tools,
            "before_agent_callback": add_timestamp_to_agent,
            "after_tool_callback": [catch_images_after_tool],
            "before_model_callback": inject_images_before_model,
        }
        if generate_web_preview:
            agent_kwargs["before_tool_callback"] = add_diagram_context_before_tool
            agent_kwargs["after_tool_callback"].append(prepare_web_preview_after_tool)

        return (
            self._build_agent(agent_kwargs),
            toolkit,
            instruction,
        )

    def create_html_diagram_agent(
        self,
        instructions: str = None,
        chatbot_name: str = None,
        name: Optional[str] = "HtmlAgent",
        description: Optional[str] = None,
        temperature: Optional[float] = 0.0,
        num_retries: Optional[int] = None,
    ) -> Agent:
        """Create a no-tool-calls agent used for HTML diagramming and web previews."""
        if not instructions:
            instructions = self.diagram_tool_config["instructions"]

        model = self.llm_factory.create_no_tool_calls_llm(
            chatbot_name,
            temperature=temperature,
            **({"num_retries": num_retries} if num_retries is not None else {}),
        )
        return self._build_agent({
            "name": name,
            "description": description or "",
            "model": model,
            "instruction": instructions + "\n\nCurrent timestamp is {time}. \n",
            "before_agent_callback": add_timestamp_to_agent,
        })

    def create_manager_agent(
        self, prompt: str, chatbot_name: str, tools: List
    ) -> Agent:
        """Create a (simple) manager agent with delegation tools."""
        cleaned_manager_prompt, chatbot_name = (
            self.prompt_processor.extract_chatbot_name_and_clean_prompt(
                prompt, chatbot_name
            )
        )
        model = self.llm_factory.create_no_parallel_tool_calls_llm(chatbot_name)

        return self._build_agent({
            "name": "manager_agent",
            "model": model,
            "instruction": cleaned_manager_prompt + "\n\n the current timestamp is {time}. \n",
            "tools": tools,
            "before_agent_callback": add_timestamp_to_agent,
            "before_tool_callback": add_additional_context,
        })

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


class ManagerAgentFactory:
    """Creates and configures manager agents that coordinate team operations."""

    def __init__(self, config, prompt_processor, llm_factory, agent_repository,tool_provider,context_builder,agent_helper):
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

        If tool_choice is 'none', the manager will not be able to delegate to agents.
        manager_specific_tools lists tool names (e.g. ['formviz']) added directly to the manager.
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
            """Check if the team has agents with search capabilities and seed task search order."""
            callback_context.state[
                "has_search_agents"] = self.agent_repository.has_search_agents() if callback_context.state.get(
                "has_search_agents", None) is None else callback_context.state.get("has_search_agents")
            if callback_context.state.get("has_search_agents"):
                delegation_factory.task_search_order = callback_context.state.get("task_search_order", 0)
                callback_context.state["task_search_order"] = delegation_factory.task_search_order

            return None

        def add_task_order_to_state(callback_context: CallbackContext) -> Optional[types.Content]:
            """Persist the task search order and search agents flag to the state."""
            # Update the state with the current task_search_order so it persists for the next session
            callback_context.state["task_search_order"] = delegation_factory.task_search_order
            callback_context.state["has_search_agents"] = self.agent_repository.has_search_agents()
            return None

        manager_config = self.agent_repository.get_agent_by_name("manager_agent") or self.agent_repository.get_agent_by_name("manager") or {}
        manager_kwargs = {
            "name": "manager_agent",
            "model": model,
            "instruction": manager_instruction+ "\n\n the current timestamp is {time}. \n",
            "tools": tools,
            "before_tool_callback": add_additional_context,
            "before_agent_callback": [check_if_agent_with_search_in_team,add_timestamp_to_agent],
            "after_agent_callback": add_task_order_to_state,
        }
        manager_agent = build_guarded_adk_agent(
            Agent,
            manager_kwargs,
            {**manager_config, "user_id": getattr(self.config, "user_id", "")},
        )

        manager_agent._team_instance = delegation_factory
        return manager_agent

    def _create_manager_instruction(self, manager_prompt: str) -> str:
        """Create the manager instruction with search, document, workspace and skill context."""
        cleaned_manager_prompt, _ = self.prompt_processor.extract_chatbot_name_and_clean_prompt(manager_prompt)
        manager_instruction = cleaned_manager_prompt + self.prompt_processor.get_web_search_prompt(1)

        manager_config = self.agent_repository.get_agent_by_name("manager_agent") or self.agent_repository.get_agent_by_name("manager") or {}
        if (
            (self.agent_repository.has_search_agents() or self.agent_repository.has_code_interpreter())
            and DocumentHelpers.document_tree_injection_enabled(manager_config)
        ):
            # Add document tree info from all agents (without IDs) for manager context
            manager_instruction += self.document_helper._get_consolidated_document_tree_info_for_manager(self.config,self.agent_repository.get_all_agents())

        manager_instruction = _append_connector_repo_context(
            manager_instruction,
            _get_connector_repo(self.config),
        )
        if not document_tree_injection_enabled(manager_config):
            manager_instruction = _append_selected_workspace_context(
                manager_instruction,
                getattr(self.config, "workspace_names", None)
                or getattr(self.config, "brain_ids", None),
                workspace_ids=getattr(self.config, "brain_ids", None),
                brain_documents=getattr(self.config, "brain_documents", None),
            )
        if document_tree_injection_enabled(manager_config):
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

        return manager_instruction

    def _add_manager_specific_tools(self, tools: List[Any], manager_specific_tools: List[str]) -> List[Any]:
        """Add manager-specific tools (formviz, plan, vectorstore MCP) to the tools list."""
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

            if tool_name_lower == 'formviz':
                try:
                    from src.smart_rag.tools.utilities.formviz_tools import generate_form_viz
                    updated_tools.append(generate_form_viz)
                    _manager_logger.info("Added generate_form_viz tool to manager agent")
                except Exception as e:
                    _manager_logger.exception(f"Error adding generate_form_viz tool to manager agent: {e}")

            elif tool_name_lower == 'plan':
                try:
                    from src.smart_rag.tools.utilities.plan_generator import generate_execution_plan
                    updated_tools.append(generate_execution_plan)
                    _manager_logger.info("Added generate_execution_plan tool to manager agent")
                except Exception as e:
                    _manager_logger.exception(f"Error adding generate_execution_plan tool to manager agent: {e}")

            else:
                _manager_logger.warning(f"Unknown manager-specific tool: {tool_name}. Skipping.")

        if enable_vectorstore_mcp:
            try:
                vectorstore_toolset = MCPHelper.create_vectorstore_toolsets_with_deep_search(
                    brain_ids=brain_ids,
                    deep_search=enable_deep_search,
                )
                updated_tools.extend(vectorstore_toolset)
                _manager_logger.info(
                    "Enabled vectorstore MCP toolset for manager agent (has_brain_ids=%s deep_search=%s)",
                    bool(brain_ids),
                    enable_deep_search,
                )
            except Exception as e:
                _manager_logger.exception(f"Error enabling vectorstore toolset for manager agent: {e}")

        return updated_tools

    def _get_document_tree_info(self, doc_tree, brain_tree) -> str:
        """Get formatted document tree information, delegated to the agent helper."""
        helper = self.agent_helper
        return helper.get_document_tree_info(doc_tree, brain_tree)

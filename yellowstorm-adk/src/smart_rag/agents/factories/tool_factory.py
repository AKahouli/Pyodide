import copy
from typing import Optional, Dict, List, Tuple, Union, Any
from src.smart_rag.tools import SearchToolADK, calculator, construct_json, generate_brain_tree_schema, \
    in_memory_construct_json, SearchToolkit, csrd_json
from src.smart_rag.agents.tools.tool_configuration import ToolConfigurationManager, ToolConfig, configure_tools, AgentParameters
from src.smart_rag.tools.utilities.tool_utils import extract_tool_names
from src.smart_rag.tools.native_tool_registry import get_native_tool
from src.logger.logging import get_logger
from src.config.settings import get_settings

settings = get_settings()
logger = get_logger("api.routers.agentic_rag.ToolFactory")

class ToolFactory:
    """Factory class for creating various tools and toolkits."""

    def __init__(self):
        """Initialize ToolFactory with configuration manager."""
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
            logger.exception(f"error while creating in-memory tools: {e}")
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
        """
        Create tools from flexible configuration list.

        This method accepts a list of dictionaries or strings and creates tools
        with intelligent defaults and custom parameters.

        Args:
            tool_configs: List of tool configurations or names
                Examples:
                - ["search", "calculator"]
                - [{"name": "search", "top_k": 10}, "calculator"]
                - [{"name": "search", "prompt": "Custom instructions", "temperature": 0.5}]
            doc_tree: Optional document tree for search tools
            brain_tree: Optional brain tree for search tools
            brain_ids: Optional brain IDs for search operations
            vectorstore_name: Name of the vector store
            task_order: Optional task ordering
            default_agent_params: Default agent parameters (temperature, max_tokens)

        Returns:
            Tuple of (created_tools, tool_config_dict)
        """
        if not tool_configs:
            logger.warning("No tool configurations provided")
            return [], {}

        try:
            # Process configurations
            processed_configs = self.config_manager.process_tool_configs(
                tool_configs,
                default_agent_params=default_agent_params
            )
            logger.debug(f"Processed {len(processed_configs)} tool configurations")
        except Exception as e:
            logger.error(f"Error processing tool configurations: {e}")
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
                    native_tool = get_native_tool(config.name)
                    if config.enabled and native_tool is not None:
                        tools.append(native_tool)
                    elif config.enabled:
                        logger.warning(f"No native implementation registered for assigned tool '{config.name}'")
                    config_dict[config.name] = config

        logger.info(f"Created {len(tools)} tools from {len(processed_configs)} configurations")
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
            logger.error(f"Tool '{tool_name}' not found in configuration")
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

        logger.info(f"Updated tool configuration for '{tool_name}'")
        return True

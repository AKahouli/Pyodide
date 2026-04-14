from typing import Dict, Any, Optional, List


from src.smart_rag.tools import build_tree
from src.smart_rag.tools.utilities import calculator, python_interpreter
from src.smart_rag.tools.utilities.connector_tools import (
    create_connector_tools,
    create_platform_tools,
)
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.infrastructure.processing.sandbox_callbacks import (
    create_sandbox_callbacks,
)
from src.logger.logging import get_logger
import json

logger = get_logger("api.smart_rag.agents.factories.delegation_factory_helper")


def create_agent_for_delegation(
    helper,
    tool_helper,
    agent_factory,
    config,
    agent_config: Dict[str, Any],
    tools: List[str],
    base_enhanced_prompt: str,
    expected_output: str,
    agent_name: str,
    chatbot_name: str,
    search_web: Optional[bool] = False,
    citation_manager=None,
) -> Any:
    """Create appropriate agent based on configuration.

    Determines the correct agent type (regular) based on configuration
    and delegates to the appropriate creation method.

    Args:
        agent_config (Dict[str, Any]): Agent configuration dictionary.
        tools (List[str]): List of tools to assign to the agent.
        base_enhanced_prompt (str): Enhanced prompt with context and tool descriptions.
        expected_output (str): Expected format or type of output.
        agent_name (str): Name for the agent instance.
        search_web (Optional[bool]): Whether to enable web search capabilities.

    Returns:
        Any: Tuple of (agent, toolkit) for the created agent.
    """
    return create_regular_agent(
        helper,
        tool_helper,
        agent_factory,
        config,
        agent_config,
        tools,
        base_enhanced_prompt,
        expected_output,
        agent_name,
        chatbot_name,
        search_web,
        citation_manager,
    )


def create_regular_agent(
    helper,
    tool_helper,
    agent_factory,
    config,
    agent_config: Dict[str, Any],
    tools: List[str],
    base_enhanced_prompt: str,
    expected_output: str,
    agent_name: str,
    chatbot_name: str,
    search_web: Optional[bool] = False,
    citation_manager=None,
) -> Any:
    """Create regular (non-HTML) agent.

    Creates a standard agent for text-based responses and general task execution,
    determining whether to create a search agent or standard agent based on tools.

    Args:
        agent_config (Dict[str, Any]): Agent configuration dictionary.
        tools (List[str]): List of tools to assign to the agent.
        base_enhanced_prompt (str): Enhanced prompt with context and instructions.
        expected_output (str): Expected format or type of output.
        agent_name (str): Name for the agent instance.
        search_web (Optional[bool]): Whether to enable web search capabilities.

    Returns:
        Any: Tuple of (agent, toolkit) for the created regular agent.
    """
    search = False
    tools_config = agent_config.get("tools", [])
    for tool in tools_config:
        if isinstance(tool, dict) and tool.get("name") == "search":
            search = True
    if search:
        return create_search_agent_with_tools(
            helper,
            agent_factory,
            config,
            agent_config,
            tools,
            base_enhanced_prompt,
            expected_output,
            agent_name,
            chatbot_name,
            search_web,
            citation_manager,
        )
    else:
        return create_standard_agent_with_tools(
            helper,
            agent_factory,
            config,
            agent_config,
            tools,
            base_enhanced_prompt,
            expected_output,
            agent_name,
            chatbot_name,
            search_web,
            citation_manager,
        )


def prepare_agent_data(
    helper,
    config,
    agent_config: Dict[str, Any],
    tools: List[str],
    base_enhanced_prompt: str,
    chatbot_name,
) -> tuple:
    """Prepare common data needed for agent creation.

    Processes agent configuration to extract and prepare all necessary data
    including document trees, brain trees, prompts, and system parameters
    required for agent instantiation.

    Args:
        agent_config (Dict[str, Any]): Agent configuration dictionary.
        tools (List[str]): List of tools assigned to the agent.
        base_enhanced_prompt (str): Base enhanced prompt to potentially modify.

    Returns:
        tuple: (doc_tree, brain_tree, enhanced_prompt, final_brain_ids,
               vectorstore_name, chatbot_name) for agent creation.
    """
    try:
        doc_tree, brain_tree = build_tree(
            agent_config.get("brain_documents", []),
            agent_config.get("brain_relations", {}),
        )
    except Exception as e:
        logger.error(f"Failed to build trees: {str(e)}")
        doc_tree, brain_tree = None, None

    # Extract and append tool-specific prompts
    tool_prompts = []
    enhanced_prompt = base_enhanced_prompt
    tools_config = agent_config.get("tools", [])
    for tool in tools_config:
        if isinstance(tool, dict):
            tool_name = tool.get("name")
            tool_prompt = tool.get("prompt")
            if tool_prompt and tool_prompt.strip():
                formatted_prompt = f"Instructions for using the '{tool_name}' tool:\n{tool_prompt.strip()}"
                tool_prompts.append(formatted_prompt)

    # Append tool prompts to enhanced prompt
    if tool_prompts:
        enhanced_prompt = enhanced_prompt + "\n\n" + "\n\n".join(tool_prompts)

    final_brain_ids = agent_config.get("brain_ids") or config.brain_ids
    vectorstore_name = agent_config.get("vectorstore_name", config.vectorstore_name)
    chatbot_name = agent_config.get("chatbot_name", chatbot_name)
    if isinstance(chatbot_name, dict):
        chatbot_name = str(chatbot_name.get("provider"))

    return (
        doc_tree,
        brain_tree,
        enhanced_prompt,
        final_brain_ids,
        vectorstore_name,
        chatbot_name,
    )


def get_enhanced_prompt(
    helper, doc_tree, brain_tree, tools: List[str], base_enhanced_prompt: str
) -> str:
    """Get enhanced prompt with document tree info if needed."""
    enhanced_prompt = base_enhanced_prompt
    if "search" in tools and doc_tree:
        enhanced_prompt += helper.get_document_tree_info(doc_tree, brain_tree)
    return enhanced_prompt


def create_search_agent_with_tools(
    helper,
    agent_factory,
    config,
    agent_config: Dict[str, Any],
    tools: List[str],
    base_enhanced_prompt: str,
    expected_output: str,
    agent_name: str,
    chatbot_name: str,
    search_web: Optional[bool],
    citation_manager=None,
) -> Any:
    """Create search agent and add additional tools if needed."""
    (
        doc_tree,
        brain_tree,
        enhanced_prompt,
        final_brain_ids,
        vectorstore_name,
        chatbot_name,
    ) = prepare_agent_data(
        helper, config, agent_config, tools, base_enhanced_prompt, chatbot_name
    )

    temp = (
        agent_config.get("agent_params").get("temperature", 0.0)
        if agent_config and agent_config.get("agent_params")
        else 0.0
    )
    if agent_config.get("agent_type") == "visualizer":
        max_tokens = (
            agent_config.get("agent_params").get("max_tokens", 30000)
            if agent_config and agent_config.get("agent_params")
            else 30000
        )
    else:
        max_tokens = (
            agent_config.get("agent_params").get("max_tokens", 20000)
            if agent_config and agent_config.get("agent_params")
            else 20000
        )
    top_k = 1
    tools_config = agent_config.get("tools", [])
    connector_bindings = []
    raw_connector_bindings = agent_config.get("agent_params", {}).get(
        "connector_bindings_json"
    )
    if raw_connector_bindings:
        try:
            connector_bindings = json.loads(raw_connector_bindings)
        except Exception as e:
            logger.exception("Failed to parse connector_bindings_json: %s", e)

    for tool in tools_config:
        if tool.get("name") == "search":
            top_k = tool.get("top_k")
            break
    agent, toolkit, _ = agent_factory.create_search_agent(
        doc_tree=doc_tree,
        brain_tree=brain_tree,
        brain_ids=final_brain_ids,
        vectorstore_name=vectorstore_name,
        search_web="standard" if search_web else "off",
        snowflake_tool=True if "snowflake connector" in tools else False,
        dataviz_tool=True if "dataviz" in tools else False,
        formviz_tool=True if "formviz" in tools else False,
        prompt=enhanced_prompt,
        task_order=expected_output,
        chatbot_name=chatbot_name,
        name=agent_name,
        temperature=temp,
        max_tokens=max_tokens,
        top_k=top_k,
        citation_manager=citation_manager,
    )

    # Store toolkit for source handling
    agent._toolkit = toolkit

    if connector_bindings:
        try:
            connector_workspace_id = agent_factory._resolve_connector_workspace_id(
                config.brain_ids[0] if config.brain_ids else None,
                agent_config.get("brain_documents", []),
            )
            agent.tools.extend(
                create_connector_tools(
                    connector_bindings,
                    workspace_id=connector_workspace_id,
                )
            )
        except Exception as e:
            logger.exception("Error adding connector tools to search agent: %s", e)

    # Platform tools (save_file_to_workspace)
    agent_params = agent_config.get("agent_params") or {}
    if agent_params.get("platform_api_url"):
        try:
            agent.tools.extend(create_platform_tools(agent_params))
        except Exception as e:
            logger.exception("Error adding platform tools to search agent: %s", e)

    if "calculator" in tools:
        agent.tools.append(calculator)

    # Add custom python_interpreter if Code Interpreter tool is present
    if "code interpreter" in tools:
        try:
            # 1. Get full brain docs from agent_config
            raw_docs = agent_config.get("brain_documents", [])

            # 2. Reduce them to only what the backend expects
            minimal_docs = MCPHelper.extract_minimal_fields(raw_docs)

            # 3. Store params on agent for session state injection (not on the global function)
            _code_interpreter_state = {
                "_code_interpreter_brain_docs": minimal_docs,
                "_code_interpreter_session_id": config.session_id,
                "_code_interpreter_brain_id": config.brain_ids[0]
                if config.brain_ids
                else None,
                "_code_interpreter_user_id": config.user_id,
            }
            agent._code_interpreter_state = _code_interpreter_state

            # 4. Register tool
            agent.tools.append(python_interpreter)
            logger.info(
                "Added python_interpreter with brain_docs, session_id, brain_id, and user_id (params will be passed via session state)"
            )

        except Exception as e:
            logger.exception("Error adding python_interpreter to search agent: %s", e)

    return agent, toolkit


def create_standard_agent_with_tools(
    helper,
    agent_factory,
    config,
    agent_config: Dict[str, Any],
    tools: List[str],
    base_enhanced_prompt: str,
    expected_output: str,
    agent_name: str,
    chatbot_name: str,
    search_web: Optional[bool],
    citation_manager=None,
) -> Any:
    """Create standard agent with configured tools."""
    temp = (
        agent_config.get("agent_params").get("temperature", 0.0)
        if agent_config and agent_config.get("agent_params")
        else 0.0
    )
    if agent_config.get("agent_type") == "visualizer":
        max_tokens = (
            agent_config.get("agent_params").get("max_tokens", 30000)
            if agent_config and agent_config.get("agent_params")
            else 30000
        )
    else:
        max_tokens = (
            agent_config.get("agent_params").get("max_tokens", 20000)
            if agent_config and agent_config.get("agent_params")
            else 20000
        )
    top_k = 1
    in_memory_tool_description = None
    html_tool_config = {}

    for tool in agent_config.get("tools", []):
        if isinstance(tool, dict) and tool.get("name") == "search":
            top_k = tool.get("top_k", 4)

            return create_search_agent_with_tools(
                helper,
                agent_factory,
                config,
                agent_config,
                tools,
                base_enhanced_prompt,
                expected_output,
                agent_name,
                chatbot_name,
                search_web,
                citation_manager,
            )

        if isinstance(tool, dict) and tool.get("name") == "in_memory":
            in_memory_tool_description = tool.get("description")

        if isinstance(tool, dict) and tool.get("name") == "html_design":
            # Extract prompt and instructions from tool if available
            html_visualization_prompt = tool.get("prompt", "")
            html_visualization_instructions = tool.get("instructions", "")
            html_tool_config["prompt"] = html_visualization_prompt
            html_tool_config["instructions"] = html_visualization_instructions
            html_tool_config.update(tool.get("config", {}))
            agent_factory.set_diagram_tool_config(html_tool_config)

    (
        doc_tree,
        brain_tree,
        enhanced_prompt,
        final_brain_ids,
        vectorstore_name,
        chatbot_name,
    ) = prepare_agent_data(
        helper, config, agent_config, tools, base_enhanced_prompt, chatbot_name
    )

    connector_bindings = []
    raw_connector_bindings = agent_config.get("agent_params", {}).get(
        "connector_bindings_json"
    )
    if raw_connector_bindings:
        try:
            connector_bindings = json.loads(raw_connector_bindings)
        except Exception as e:
            logger.exception("Failed to parse connector_bindings_json: %s", e)

    agent = agent_factory.create_agent(
        name=agent_name,
        prompt=enhanced_prompt,
        chatbot_name=chatbot_name,
        calculator_tool=True if "calculator" in tools else False,
        search_web_tool=True if "search_web" in tools else False,
        in_memory_tool=True if "in_memory" in tools else False,
        in_memory_tool_description=in_memory_tool_description,
        html_design=True if "html_design" in tools else False,
        search_tool=True if "search" in tools else False,
        code_interpreter_tool=True if "code interpreter" in tools else False,
        snowflake_tool=True if "snowflake connector" in tools else False,
        dataviz_tool=True if "dataviz" in tools else False,
        formviz_tool=True if "formviz" in tools else False,
        skills=agent_config.get("skills", []),
        doc_tree=doc_tree,
        brain_tree=brain_tree,
        top_k=top_k,
        brain_ids=final_brain_ids,
        vectorstore_name=vectorstore_name,
        task_order=expected_output,
        temperature=temp,
        max_tokens=max_tokens,
        session_id=config.session_id,
        brain_documents=agent_config.get("brain_documents", []),
        conversation_brain_id=config.brain_ids[0] if config.brain_ids else None,
        user_id=config.user_id,
        connector_bindings=connector_bindings,
    )

    # Platform tools (save_file_to_workspace)
    agent_params = agent_config.get("agent_params") or {}
    if agent_params.get("platform_api_url"):
        try:
            agent.tools.extend(create_platform_tools(agent_params))
        except Exception as e:
            logger.exception("Error adding platform tools to standard agent: %s", e)

    return agent, None


def _extract_original_expected_output(task_description: str) -> tuple:
    """Extract and remove original_expected_output from task_description.

    Extracts content between ##original_expected_output## markers and removes
    it from the task description, returning both the cleaned task description
    and the extracted original expected output.

    Args:
        task_description (str): Raw task description containing markers

    Returns:
        tuple: (cleaned_task_description, original_expected_output)

    Example:
        Input: "Do this ##original_expected_output##Expected result##/original_expected_output##"
        Output: ("Do this", "Expected result")
    """
    import re2 as re

    # Pattern to match ##original_expected_output##...##/original_expected_output##
    # (?s) is the inline flag equivalent to re.DOTALL, making . match newlines
    pattern = r"(?s)##original_expected_output##(.*?)##/original_expected_output##"

    match = re.search(pattern, task_description)

    if match:
        original_expected_output = match.group(1).strip()
        cleaned_task_description = re.sub(pattern, "", task_description).strip()
        return cleaned_task_description, original_expected_output

    # If no marker found, return task_description as is with empty original_expected_output
    logger.debug(
        f"[EXTRACTION] No original_expected_output marker found in task_description"
    )
    return task_description, ""

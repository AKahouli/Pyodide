from typing import Dict, Any, Optional, List


from src.smart_rag.tools import build_tree
from src.smart_rag.tools.utilities import calculator, python_interpreter
from src.smart_rag.tools.utilities.connector_tools import (
    ConnectorToolContext,
    create_connector_tools,
)
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.infrastructure.processing.sandbox_callbacks import (
    create_sandbox_callbacks,
)
from src.smart_rag.infrastructure.model_parameters import resolve_model_config
from src.logger.logging import get_logger
import json

logger = get_logger("api.smart_rag.agents.factories.delegation_factory_helper")


def _resolve_temperature(agent_params: Dict[str, Any]) -> Optional[float]:
    if agent_params.get("omit_temperature") == "true":
        return None
    try:
        return float(agent_params.get("temperature", 0.0))
    except (TypeError, ValueError):
        logger.warning("invalid_agent_temperature value=%r defaulting=0.0", agent_params.get("temperature"))
        return 0.0


def _is_tool_enabled(tools_config: List[Any], tool_name: str) -> bool:
    for tool in tools_config:
        if isinstance(tool, str):
            if tool == tool_name:
                return True
        elif tool.get("name") == tool_name and tool.get("enabled", True):
            return True
    return False


def _get_enabled_tool_config(
    tools_config: List[Any], tool_name: str
) -> Dict[str, Any] | None:
    for tool in tools_config:
        if isinstance(tool, str) and tool == tool_name:
            return {"name": tool_name}
        if (
            isinstance(tool, dict)
            and tool.get("name") == tool_name
            and tool.get("enabled", True)
        ):
            return tool
    return None


def _append_run_code_guidance(
    prompt: str,
    tools_config: List[Any],
    runtime_context: Dict[str, Any],
) -> str:
    if not _get_enabled_tool_config(tools_config, "run_code"):
        return prompt
    from src.infrastructure.run_code.context import parse_run_code_context
    from src.smart_rag.tools.utilities.run_code import (
        RUN_CODE_PROMPT_GUIDANCE,
        run_code_globally_enabled,
    )

    if not run_code_globally_enabled() or parse_run_code_context(runtime_context) is None:
        return prompt
    return f"{prompt}\n\n{RUN_CODE_PROMPT_GUIDANCE}"


def _build_connector_repo_fixed_params(
    connector_repo: Dict[str, str],
) -> Dict[str, str]:
    repo_id = connector_repo.get("repo_id", "").strip()
    repo_name = connector_repo.get("repo_name", "").strip()
    repo_url = connector_repo.get("repo_url", "").strip()
    if not repo_name:
        return {}

    fixed_params = {
        "repo_name": repo_name,
        "repo_id": repo_id,
        "repo_url": repo_url,
        "repository": repo_name,
        "full_name": repo_name,
    }

    if "/" in repo_name:
        owner, repo = repo_name.split("/", 1)
        owner = owner.strip()
        repo = repo.strip()
        if owner:
            fixed_params["owner"] = owner
            fixed_params["repo_owner"] = owner
        if repo:
            fixed_params["repo"] = repo
            fixed_params["repository_name"] = repo

    return {key: value for key, value in fixed_params.items() if value}


def _inject_connector_repo_into_bindings(
    bindings: List[Dict[str, Any]],
    connector_repo: Optional[Dict[str, str]],
) -> List[Dict[str, Any]]:
    if not connector_repo:
        return bindings
    repo_name = connector_repo.get("repo_name", "").strip()
    if not repo_name:
        return bindings
    connector_id = connector_repo.get("connector_id", "").strip()
    repo_fixed_params = _build_connector_repo_fixed_params(connector_repo)
    augmented = []
    for binding in bindings:
        binding_copy = dict(binding)
        if not connector_id or binding.get("connector_id") == connector_id:
            existing_fixed = dict(binding_copy.get("fixed_params") or {})
            existing_fixed.update(repo_fixed_params)
            binding_copy["fixed_params"] = existing_fixed
        augmented.append(binding_copy)
    logger.info(
        "connector_bindings_injected_repo connector_id=%s repo=%s binding_count=%s",
        connector_id or "(any)",
        repo_name,
        len(augmented),
    )
    return augmented


def _append_connector_repo_context(
    prompt: str,
    connector_repo: Optional[Dict[str, str]],
) -> str:
    if not connector_repo:
        return prompt
    repo_name = connector_repo.get("repo_name", "").strip()
    if not repo_name:
        return prompt

    connector_name = connector_repo.get("connector_name", "").strip() or "connector"
    repo_url = connector_repo.get("repo_url", "").strip()
    target = f"{repo_name} ({repo_url})" if repo_url else repo_name
    context = (
        "\n\n<selected_connector_repository>\n"
        f"Connector: {connector_name}\n"
        f"Repository: {target}\n"
        "Use the connector tools for repository-level actions on this repository. "
        "Do not ask the user which repository to use.\n"
        "</selected_connector_repository>"
    )
    return f"{prompt}{context}"


def _build_workspace_document_context(brain_documents: Any) -> str:
    if not isinstance(brain_documents, list):
        return ""

    documents = []
    seen = set()
    for doc in brain_documents:
        if not isinstance(doc, dict):
            continue
        filename = str(doc.get("filename") or doc.get("file_name") or "").strip()
        file_name = str(doc.get("file_name") or filename).strip()
        workspace_id = str(doc.get("workspace_id") or "").strip()
        workspace_name = str(doc.get("workspace_name") or workspace_id).strip()
        if not filename and not file_name:
            continue
        signature = (filename, file_name, workspace_id)
        if signature in seen:
            continue
        seen.add(signature)
        documents.append(
            {
                "filename": filename or file_name,
                "file_name": file_name or filename,
                "workspace_id": workspace_id,
                "workspace_name": workspace_name,
            }
        )

    if not documents:
        return ""

    return "\n".join(
        [
            "<workspace_documents>",
            "Use these exact file names and workspace IDs when calling MCP connector document tools.",
            json.dumps(documents, ensure_ascii=False, indent=2),
            "</workspace_documents>",
        ]
    )


def _append_workspace_document_context(
    prompt: str,
    brain_documents: Any,
    *,
    enabled: bool = True,
) -> str:
    if not enabled:
        return prompt
    context = _build_workspace_document_context(brain_documents)
    if not context:
        return prompt
    return f"{prompt}\n\n{context}"


def _append_selected_workspace_context(
    prompt: str,
    workspace_names: Any,
    *,
    workspace_ids: Any = None,
    brain_documents: Any = None,
) -> str:
    """Always expose the selected workspace scope in the system prompt.

    This is intentionally independent from document-tree injection: disabling
    document context must not remove the workspace scope used by search and
    connector tools.
    """
    def _values(raw: Any) -> list[str]:
        if isinstance(raw, str):
            raw = [raw]
        if not isinstance(raw, (list, tuple, set)):
            return []
        result = []
        for item in raw:
            value = " ".join(str(item or "").split())
            if value and value not in result:
                result.append(value)
        return result

    names = _values(workspace_names)
    ids = _values(workspace_ids)
    if not names and not ids:
        return prompt

    document_names_by_id = {}
    document_ids_by_name = {}
    if isinstance(brain_documents, list):
        for document in brain_documents:
            if not isinstance(document, dict):
                continue
            workspace_id = " ".join(str(document.get("workspace_id") or "").split())
            workspace_name = " ".join(str(document.get("workspace_name") or "").split())
            if workspace_id and workspace_name:
                document_names_by_id[workspace_id] = workspace_name
                document_ids_by_name[workspace_name] = workspace_id

    workspaces = []
    for index in range(max(len(ids), len(names))):
        workspace_id = ids[index] if index < len(ids) else ""
        workspace_name = names[index] if index < len(names) else ""
        workspace_name = workspace_name or document_names_by_id.get(workspace_id, "")
        workspace_id = workspace_id or document_ids_by_name.get(workspace_name, "")
        workspace_id = workspace_id or workspace_name
        workspace_name = workspace_name or workspace_id
        item = {"workspace_id": workspace_id, "workspace_name": workspace_name}
        if item not in workspaces:
            workspaces.append(item)

    lines = [
        "<selected_workspaces>",
        "These workspaces are selected for this agent:",
        json.dumps(workspaces, ensure_ascii=False, indent=2),
        "</selected_workspaces>",
    ]
    return f"{prompt}\n\n" + "\n".join(lines)


def _append_capability_aware_file_context(
    prompt: str,
    brain_documents: Any,
    tools_config: Any,
    *,
    preserve_for_legacy_connector: bool = False,
    inject_document_tree: bool = True,
) -> str:
    if not inject_document_tree:
        return prompt
    if preserve_for_legacy_connector:
        return _append_workspace_document_context(prompt, brain_documents)
    names = {
        str(tool.get("name") if isinstance(tool, dict) else tool or "").strip().lower()
        for tool in tools_config or []
        if isinstance(tool, (dict, str))
    }
    discovery_capabilities = {"run_code", "search"}
    if names and names <= discovery_capabilities:
        return prompt
    return _append_workspace_document_context(prompt, brain_documents)


def _append_current_attachment_context(
    prompt: str,
    attached_files: Any,
    runtime_context: Dict[str, Any],
    *,
    enabled: bool = True,
) -> str:
    if not enabled:
        return prompt
    if not isinstance(attached_files, list) or not attached_files:
        return prompt

    names = []
    for item in attached_files:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(item.get("filename") or item.get("name") or "").split())
        name = name.replace("{", "(").replace("}", ")").replace("<", "").replace(">", "")
        if name and name not in names:
            names.append(name[:255])
    if not names:
        return prompt

    logical_paths = []
    from src.infrastructure.run_code.context import parse_run_code_context

    run_code_context = parse_run_code_context(runtime_context)
    if run_code_context is not None:
        for source in run_code_context.sources:
            if source.scope.kind != "files":
                continue
            for relative_path in source.scope.relativePaths:
                logical_path = f"/workspace/attachments/{source.alias}/{relative_path}"
                if "{" not in logical_path and "}" not in logical_path:
                    logical_paths.append(logical_path)

    lines = [
        "<current_attachments>",
        "The user attached these files to the current message:",
    ]
    for name in names:
        matches = [path for path in logical_paths if path.rsplit("/", 1)[-1] == name]
        if not matches and len(names) == 1 and len(logical_paths) == 1:
            matches = logical_paths
        lines.append(f"- File: {name}")
        lines.extend(f"  Logical path: {path}" for path in matches)
    if logical_paths:
        lines.append("Use the logical path with the available file tool. Do not ask which file was attached.")
    else:
        lines.append("Use the available file or search tool for these files. Do not ask which file was attached.")
    lines.append("</current_attachments>")
    return f"{prompt}\n\n" + "\n".join(lines)


def _get_connector_repo(config: Any) -> Optional[Dict[str, str]]:
    connector_repo = getattr(config, "connector_repo", None)
    return connector_repo if isinstance(connector_repo, dict) else None


def _get_team_skills(config: Any) -> List[Dict[str, Any]]:
    """Conversation-level skills selected by the user (applied to every agent)."""
    skills = getattr(config, "skills", None)
    return skills if isinstance(skills, list) else []


def merge_skills(
    agent_skills: Optional[List[Any]],
    team_skills: Optional[List[Any]],
) -> List[Any]:
    """Combine an agent's own skills with the conversation-level skills.

    Conversation skills are appended; duplicates (by id, falling back to name)
    are dropped so the catalog and activation tool stay clean.
    """
    merged: List[Any] = list(agent_skills or [])

    def _key(skill: Any) -> str:
        getter = skill.get if isinstance(skill, dict) else lambda k, d=None: getattr(skill, k, d)
        return str(getter("id") or getter("name") or "").strip()

    seen = {_key(skill) for skill in merged if _key(skill)}
    for skill in team_skills or []:
        key = _key(skill)
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        merged.append(skill)
    return merged


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
        tuple: (doc_tree, brain_tree, enhanced_prompt, final_workspace_names,
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

    final_workspace_names = agent_config.get("brain_ids") or config.brain_ids
    vectorstore_name = agent_config.get("vectorstore_name", config.vectorstore_name)
    chatbot_name = agent_config.get("chatbot_name", chatbot_name)
    chatbot_name = resolve_model_config(chatbot_name)

    return (
        doc_tree,
        brain_tree,
        enhanced_prompt,
        final_workspace_names,
        vectorstore_name,
        chatbot_name,
    )


def get_enhanced_prompt(
    helper,
    doc_tree,
    brain_tree,
    tools: List[str],
    base_enhanced_prompt: str,
    inject_document_tree: bool = True,
) -> str:
    """Get enhanced prompt with document tree info if needed."""
    enhanced_prompt = base_enhanced_prompt
    if inject_document_tree and doc_tree:
        enhanced_prompt += helper.get_document_tree_info(doc_tree, brain_tree)
    return enhanced_prompt


def document_tree_injection_enabled(agent_config: Optional[Dict[str, Any]]) -> bool:
    """Return whether document trees may be added to an agent system prompt.

    The value is transported through ``agent_params`` as a string by the backend,
    so accept common boolean representations while preserving the historical
    default of enabled when the setting is absent.
    """
    params = (agent_config or {}).get("agent_params") or {}
    value = params.get("document_tree_injection_enabled", True)
    if isinstance(value, str):
        return value.strip().lower() not in {"false", "0", "no", "off"}
    return value is not False


def _build_mcp_context_note(config, agent_config: Dict[str, Any]) -> str:
    """Build a prompt note with MCP context values for streamable_http transport."""
    mcp = agent_config.get("mcp")
    if not mcp or mcp.get("transport_type") != "streamable_http":
        return ""

    user_id = getattr(config, "user_id", None) or ""
    # Use only explicitly bound file_names (from input port bindings), not all brain_documents
    explicit_file_names = agent_config.get("file_names") or []
    # Use workspace IDs directly (brain_ids from config)
    workspace_ids = list(getattr(config, "brain_ids", None) or [])

    if not user_id and not explicit_file_names and not workspace_ids:
        return ""

    lines = ["<mcp_tool_context>"]
    if user_id:
        lines.append(f'- user_id: "{user_id}"')
    if explicit_file_names:
        val = json.dumps(explicit_file_names) if len(explicit_file_names) > 1 else f'"{explicit_file_names[0]}"'
        lines.append(f"- file_name: {val}")
    if workspace_ids:
        val = json.dumps(workspace_ids) if len(workspace_ids) > 1 else f'"{workspace_ids[0]}"'
        lines.append(f"- workspace_id: {val}")
    lines.append("</mcp_tool_context>")
    return "\n".join(lines)


def _append_attachment_context(prompt: str, config: Any) -> str:
    """Append the backend-built bounded <conversation_attachments> block.

    Executor-level only: managers intentionally receive the lightweight file
    manifest instead, so full attachment content is not duplicated per agent.
    """
    text = getattr(config, "attachment_context", None)
    if not text:
        return prompt
    return f"{prompt}\n\n{text}"


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
        final_workspace_names,
        vectorstore_name,
        chatbot_name,
    ) = prepare_agent_data(
        helper, config, agent_config, tools, base_enhanced_prompt, chatbot_name
    )
    if not document_tree_injection_enabled(agent_config):
        enhanced_prompt = _append_selected_workspace_context(
            enhanced_prompt,
            agent_config.get("workspace_names")
            or getattr(config, "workspace_names", None)
            or final_workspace_names,
            workspace_ids=agent_config.get("brain_ids")
            or getattr(config, "brain_ids", None)
            or final_workspace_names,
            brain_documents=agent_config.get("brain_documents")
            or getattr(config, "brain_documents", None),
        )
    enhanced_prompt = _append_connector_repo_context(
        enhanced_prompt,
        _get_connector_repo(config),
    )
    tools_config = agent_config.get("tools", [])
    enhanced_prompt = _append_capability_aware_file_context(
        enhanced_prompt,
        agent_config.get("brain_documents", []),
        tools_config,
        preserve_for_legacy_connector=_get_connector_repo(config) is not None,
        inject_document_tree=document_tree_injection_enabled(agent_config),
    )
    enhanced_prompt = _append_current_attachment_context(
        enhanced_prompt,
        getattr(config, "attached_files", None),
        agent_config.get("agent_params") or {},
        enabled=document_tree_injection_enabled(agent_config),
    )
    enhanced_prompt = _append_attachment_context(enhanced_prompt, config)

    agent_params = agent_config.get("agent_params") or {}
    telegram_validation_instruction = agent_params.get("telegram_validation_instruction")
    if isinstance(telegram_validation_instruction, str) and telegram_validation_instruction.strip():
        enhanced_prompt = f"{enhanced_prompt}\n\n{telegram_validation_instruction.strip()}"
    enhanced_prompt = _append_run_code_guidance(
        enhanced_prompt,
        tools_config,
        agent_params,
    )
    temp = _resolve_temperature(agent_params)
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
    preview_tool_config = _get_enabled_tool_config(
        tools_config, "generate_web_preview"
    )
    if preview_tool_config:
        agent_factory.set_web_preview_tool_config(preview_tool_config)
    connector_bindings = []
    _agent_params_search = agent_config.get("agent_params") or {}
    raw_connector_bindings = _agent_params_search.get("connector_bindings_json")
    if raw_connector_bindings:
        try:
            connector_bindings = json.loads(raw_connector_bindings)
        except Exception as e:
            logger.exception("Failed to parse connector_bindings_json: %s", e)

    for tool in tools_config:
        if tool.get("name") == "search":
            top_k = tool.get("top_k")
            break
    logical_search_only = "logical_search" in tools and "search" not in tools
    deep_search = "deep_search" in tools
    agent, toolkit, _ = agent_factory.create_search_agent(
        doc_tree=doc_tree,
        brain_tree=brain_tree,
        brain_ids=final_workspace_names,
        vectorstore_name=vectorstore_name,
        search_web="standard" if search_web else "off",
        formviz_tool=True if "formviz" in tools else False,
        prompt=enhanced_prompt,
        task_order=expected_output,
        chatbot_name=chatbot_name,
        name=agent_name,
        temperature=temp,
        max_tokens=max_tokens,
        top_k=top_k,
        citation_manager=citation_manager,
        user_id=config.user_id,
        vectorstore_mcp_tool=True if "logical_search" in tools or "deep_search" in tools else False,
        logical_search_only=logical_search_only,
        deep_search=deep_search,
        render_chart_tool=_is_tool_enabled(tools_config, "render_chart"),
        generate_web_preview=preview_tool_config is not None,
        skills=merge_skills(agent_config.get("skills", []), _get_team_skills(config)),
        document_tree_injection_enabled=document_tree_injection_enabled(agent_config),
    )

    # Store toolkit for source handling
    agent._toolkit = toolkit

    from src.smart_rag.tools.native_tool_registry import FACTORY_MANAGED_NATIVE_TOOLS, resolve_native_tools
    agent_params = agent_config.get("agent_params") or {}
    agent.tools.extend(resolve_native_tools(
        [
            tool for tool in tools_config
            if (tool if isinstance(tool, str) else tool.get("name")) not in FACTORY_MANAGED_NATIVE_TOOLS
        ],
        runtime_context=agent_params,
    ))

    if connector_bindings:
        try:
            connector_workspace_id = agent_factory._resolve_connector_workspace_id(
                config.brain_ids[0] if config.brain_ids else None,
                agent_config.get("brain_documents", []),
            )
            connector_bindings = _inject_connector_repo_into_bindings(
                connector_bindings,
                _get_connector_repo(config),
            )
            agent.tools.extend(
                create_connector_tools(
                    connector_bindings,
                    ConnectorToolContext(
                        workspace_id=connector_workspace_id,
                        brain_ids=final_workspace_names,
                        brain_documents=agent_config.get("brain_documents", []),
                        file_names=agent_config.get("file_names", []),
                        session_id=config.session_id,
                        agent_id=agent_config.get("id"),
                        user_id=config.user_id,
                        platform_api_token=str(
                            (agent_config.get("agent_params") or {}).get(
                                "platform_api_token", ""
                            )
                        ),
                    ),
                )
            )
        except Exception as e:
            logger.exception("Error adding connector tools to search agent: %s", e)

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

    _attach_mcp_search_state(agent, config, agent_config)
    _attach_mcp_toolset(agent, config, agent_config)

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
    agent_params = agent_config.get("agent_params") or {}
    temp = _resolve_temperature(agent_params)
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

    preview_tool_config = _get_enabled_tool_config(
        agent_config.get("tools", []), "generate_web_preview"
    )
    if preview_tool_config:
        agent_factory.set_web_preview_tool_config(preview_tool_config)

    (
        doc_tree,
        brain_tree,
        enhanced_prompt,
        final_workspace_names,
        vectorstore_name,
        chatbot_name,
    ) = prepare_agent_data(
        helper, config, agent_config, tools, base_enhanced_prompt, chatbot_name
    )
    if not document_tree_injection_enabled(agent_config):
        enhanced_prompt = _append_selected_workspace_context(
            enhanced_prompt,
            agent_config.get("workspace_names")
            or getattr(config, "workspace_names", None)
            or final_workspace_names,
            workspace_ids=agent_config.get("brain_ids")
            or getattr(config, "brain_ids", None)
            or final_workspace_names,
            brain_documents=agent_config.get("brain_documents")
            or getattr(config, "brain_documents", None),
        )
    enhanced_prompt = _append_connector_repo_context(
        enhanced_prompt,
        _get_connector_repo(config),
    )
    enhanced_prompt = _append_capability_aware_file_context(
        enhanced_prompt,
        agent_config.get("brain_documents", []),
        agent_config.get("tools", []),
        preserve_for_legacy_connector=_get_connector_repo(config) is not None,
        inject_document_tree=document_tree_injection_enabled(agent_config),
    )
    enhanced_prompt = _append_current_attachment_context(
        enhanced_prompt,
        getattr(config, "attached_files", None),
        agent_params,
        enabled=document_tree_injection_enabled(agent_config),
    )
    enhanced_prompt = _append_attachment_context(enhanced_prompt, config)
    enhanced_prompt = _append_run_code_guidance(
        enhanced_prompt,
        agent_config.get("tools", []),
        agent_params,
    )

    connector_bindings = []
    _agent_params_std = agent_config.get("agent_params") or {}
    raw_connector_bindings = _agent_params_std.get("connector_bindings_json")
    if raw_connector_bindings:
        try:
            connector_bindings = json.loads(raw_connector_bindings)
        except Exception as e:
            logger.exception("Failed to parse connector_bindings_json: %s", e)

    callback_config = {
        **agent_config,
        "user_id": config.user_id,
        "agent_params": agent_config.get("agent_params") or {},
    }
    agent_factory.set_guardrail_config(callback_config)
    agent = agent_factory.create_agent(
        name=agent_name,
        agent_id=agent_config.get("id"),
        prompt=enhanced_prompt,
        chatbot_name=chatbot_name,
        calculator_tool=True if "calculator" in tools else False,
        render_chart_tool=_is_tool_enabled(agent_config.get("tools", []), "render_chart"),
        search_web_tool=True if "search_web" in tools else False,
        in_memory_tool=True if "in_memory" in tools else False,
        in_memory_tool_description=in_memory_tool_description,
        html_design=True if "html_design" in tools else False,
        generate_web_preview=preview_tool_config is not None,
        search_tool=True if "search" in tools else False,
        code_interpreter_tool=True if "code interpreter" in tools else False,
        formviz_tool=True if "formviz" in tools else False,
        skills=merge_skills(agent_config.get("skills", []), _get_team_skills(config)),
        doc_tree=doc_tree,
        brain_tree=brain_tree,
        top_k=top_k,
        brain_ids=final_workspace_names,
        vectorstore_name=vectorstore_name,
        task_order=expected_output,
        temperature=temp,
        max_tokens=max_tokens,
        session_id=config.session_id,
        brain_documents=agent_config.get("brain_documents", []),
        file_names=agent_config.get("file_names", []),
        conversation_brain_id=config.brain_ids[0] if config.brain_ids else None,
        user_id=config.user_id,
        connector_bindings=_inject_connector_repo_into_bindings(
            connector_bindings,
            _get_connector_repo(config),
        ),
        platform_api_token=str(_agent_params_std.get("platform_api_token", "")),
        document_tree_injection_enabled=document_tree_injection_enabled(agent_config),
    )

    # Catalogue assignment controls native UI tools; metadata alone never makes a
    # Python callable available to an agent.
    from src.smart_rag.tools.native_tool_registry import FACTORY_MANAGED_NATIVE_TOOLS, resolve_native_tools
    agent.tools.extend(resolve_native_tools([
        tool for tool in agent_config.get("tools", [])
        if (tool if isinstance(tool, str) else tool.get("name")) not in FACTORY_MANAGED_NATIVE_TOOLS
    ],
    runtime_context=agent_params,
    ))

    _attach_mcp_search_state(agent, config, agent_config)
    _attach_mcp_toolset(agent, config, agent_config)

    from src.guardrails.adapters.google_adk import apply_guardrails_to_agent

    apply_guardrails_to_agent(agent, callback_config)

    return agent, None


def _attach_mcp_toolset(agent, config, agent_config: Dict[str, Any]) -> None:
    """Create and attach an MCPToolset if the agent config has an mcp field."""
    mcp = agent_config.get("mcp")
    if not mcp:
        return

    transport_type = mcp.get("transport_type")
    server_url = mcp.get("server_url")

    if transport_type != "streamable_http" or not server_url:
        return

    # Use only explicitly bound file_names (from input port bindings), not all brain_documents
    explicit_file_names = agent_config.get("file_names") or None
    # Use workspace IDs directly (brain_ids from config)
    workspace_ids = list(getattr(config, "brain_ids", None) or []) or None

    try:
        auth_headers = dict(mcp.get("auth_headers") or {})
        agent_tools = agent_config.get("tools") or []
        if any(isinstance(t, dict) and t.get("name") == "deep_search" or t == "deep_search" for t in agent_tools):
            auth_headers["X-Deep-Search"] = "true"

        toolsets = MCPHelper.create_toolsets([{
            "type": "mcp",
            "transport_type": "streamable_http",
            "url": server_url,
            "user_id": config.user_id,
            "file_names": explicit_file_names,
            "workspace_ids": workspace_ids,
            "auth_headers": auth_headers,
        }])
        if toolsets:
            if not hasattr(agent, "tools") or agent.tools is None:
                agent.tools = []
            agent.tools.extend(toolsets)
            logger.info(
                f"Attached MCPToolset ({server_url}) to agent {agent.name} "
                f"for user {config.user_id}"
            )
    except Exception as e:
        logger.exception(f"Error creating MCPToolset for agent {agent.name}: {e}")


def _attach_mcp_search_state(agent, config, agent_config: Dict[str, Any]) -> None:
    state = {"_mcp_search_user_id": config.user_id}
    if config.brain_ids:
        state["_mcp_search_workspace_id"] = (
            config.brain_ids[0] if len(config.brain_ids) == 1 else config.brain_ids
        )
    agent._mcp_search_state = state


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

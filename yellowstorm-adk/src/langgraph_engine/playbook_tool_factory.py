"""Factory for creating LangChain tools from playbook agent configurations.

Bridges the gap between playbook agent tool configs (name-based) and real
executable LangChain StructuredTool instances, reusing the same search
infrastructure as RunAgentTeam (SearchToolkit, build_tree, etc.).
"""

import copy
from typing import Dict, Any, List, Optional, Tuple

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from structlog import get_logger

logger = get_logger(__name__)


# --- ToolResultCollector ---

class ToolResultCollector:
    """Collects structured components from tool executions.

    Shared between all tools of a single agent so the agentic loop
    can drain components after each tool call.
    """

    def __init__(self):
        self.components: List[dict] = []

    def add_component(self, component_type: str, data: dict):
        self.components.append({"type": component_type, "data": data})

    def get_and_clear(self) -> List[dict]:
        result = list(self.components)
        self.components.clear()
        return result


# --- Pydantic schemas for tool inputs ---

class SearchQueryInput(BaseModel):
    query: str = Field(description="The search query string.")


class BrainSearchInput(BaseModel):
    query: str = Field(description="The search query string.")
    brain_name: Optional[str] = Field(default=None, description="Specific brain/workspace to search in.")
    document_filter: Optional[str] = Field(default=None, description="Filter by specific document.")


class InMemoryInput(BaseModel):
    file_name: str = Field(description="Name of the file to extract content from.")


class CalculatorInput(BaseModel):
    expression: str = Field(description="Mathematical expression to evaluate. Supports: +, -, *, /, **, %, sqrt().")


class WebSearchInput(BaseModel):
    query: str = Field(description="The web search query.")


class CodeInterpreterInput(BaseModel):
    code: str = Field(description="Python 3 code to execute in an isolated sandbox.")
    timeout_seconds: int = Field(default=60, description="Maximum execution time in seconds (max 300).")


class PlanGeneratorInput(BaseModel):
    title: str = Field(description="Title of the execution plan.")
    steps: str = Field(
        description=(
            "JSON string containing an array of step objects. "
            "Each step must have 'task' and 'agent' fields. "
            "Example: '[{\"task\": \"Search docs\", \"agent\": \"search_agent\"}]'"
        )
    )


def create_langchain_tools(
    agent_config: dict,
    workspace_context: Optional[list] = None,
    input_files: Optional[List[str]] = None,
) -> Tuple[List[StructuredTool], ToolResultCollector]:
    """Create LangChain StructuredTool instances from a playbook agent config.

    Args:
        agent_config: Agent dict with keys like tools, brain_ids, brain_documents.
        workspace_context: Optional workspace context list (from gRPC request).
        input_files: Optional list of document external_ids to restrict search to.

    Returns:
        Tuple of (list of StructuredTools, ToolResultCollector).
    """
    collector = ToolResultCollector()

    tool_configs = agent_config.get("tools", [])
    if not tool_configs:
        return [], collector

    tool_names = {
        t["name"] for t in tool_configs if isinstance(t, dict) and t.get("name")
    }
    if not tool_names:
        return [], collector

    tools: List[StructuredTool] = []

    # Merge workspace context into agent brain data
    brain_ids, brain_documents = _merge_brain_data(agent_config, workspace_context)

    # Determine top_k from tool configs
    top_k = _get_top_k(tool_configs)

    # Build trees for search-related tools
    needs_search = bool({"search", "in_memory"} & tool_names)
    doc_tree = None
    brain_tree = None

    if brain_documents and needs_search:
        from src.smart_rag.tools import build_tree
        doc_tree, brain_tree = build_tree(
            brain_documents, {"nodes": [], "relationships": []}
        )

    # --- Search tools ---
    # Search tools can be created with doc_tree if available, or with input_files for filtered search
    if "search" in tool_names and (doc_tree or input_files):
        search_tools = _create_search_tools(
            tool_configs, doc_tree, brain_tree, brain_ids, top_k, collector,
            input_files=input_files
        )
        tools.extend(search_tools)

    # --- In-memory tool ---
    if "in_memory" in tool_names and doc_tree:
        in_memory_tools = _create_in_memory_tools(
            tool_configs, doc_tree, brain_ids, top_k
        )
        tools.extend(in_memory_tools)

    # --- Calculator ---
    if "calculator" in tool_names:
        tools.append(_create_calculator_tool())

    # --- Web search ---
    if "search_web" in tool_names:
        web_tool = _create_web_search_tool(brain_ids, collector)
        if web_tool:
            tools.append(web_tool)

    # --- Code interpreter ---
    if "code interpreter" in tool_names:
        code_tool = _create_code_interpreter_tool(agent_config, brain_ids, brain_documents, collector)
        if code_tool:
            tools.append(code_tool)

    # --- Plan generator ---
    if "plan" in tool_names:
        tools.append(_create_plan_tool())

    logger.info(
        "Created LangChain tools for playbook agent",
        agent=agent_config.get("name"),
        tool_count=len(tools),
        tool_names=[t.name for t in tools],
    )
    return tools, collector


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _merge_brain_data(
    agent_config: dict, workspace_context: Optional[list]
) -> tuple:
    """Merge agent brain_ids/brain_documents with workspace_context."""
    brain_ids = list(agent_config.get("brain_ids") or [])
    brain_documents = list(agent_config.get("brain_documents") or [])

    if workspace_context:
        for wc in workspace_context:
            wid = wc.get("workspace_id")
            if wid and wid not in brain_ids:
                brain_ids.append(wid)
            for doc in wc.get("documents", []):
                brain_documents.append({
                    "_id": doc.get("id", doc.get("_id", "")),
                    "filename": doc.get("filename", ""),
                    "filepath": doc.get("filepath", ""),
                    "workspace_id": doc.get("workspace_id", wid or ""),
                })

    return brain_ids, brain_documents


def _get_top_k(tool_configs: list) -> int:
    """Extract the max top_k from tool configs, default 4."""
    values = [
        t.get("top_k", 4)
        for t in tool_configs
        if isinstance(t, dict) and t.get("top_k")
    ]
    return max(values) if values else 4


def _get_tool_description(tool_configs: list, tool_name: str) -> str:
    """Get a custom description from tool config if present."""
    for t in tool_configs:
        if isinstance(t, dict) and t.get("name") == tool_name:
            return t.get("description", "")
    return ""


def _format_available_filenames(brain_documents: list, max_files: int = 12) -> str:
    """Return a short human-readable list of available filenames."""
    filenames = []
    seen = set()
    for doc in brain_documents or []:
        filename = str(doc.get("filename", "")).strip()
        if filename and filename not in seen:
            filenames.append(filename)
            seen.add(filename)

    if not filenames:
        return ""

    visible = filenames[:max_files]
    suffix = ""
    if len(filenames) > max_files:
        suffix = f" (+{len(filenames) - max_files} more)"
    return ", ".join(visible) + suffix


def _extract_citation_components(toolkit) -> List[dict]:
    """Extract citation components from a SearchToolkit's accumulated sources.

    Reads toolkit.sources_text and toolkit.sources_image and converts them
    to component dicts ready for the collector.
    """
    components = []

    for src in getattr(toolkit, "sources_text", []):
        obj = src.get("object", {})
        content = obj.get("content", {})
        components.append({
            "type": "citation",
            "data": {
                "parent_id": "",
                "text_source": {
                    "type": "text",
                    "source": content.get("source", ""),
                    "external_id": content.get("external_id", ""),
                    "page": str(content.get("page", "")),
                    "page_content": content.get("page_content", ""),
                    "workspace_id": content.get("brain_id", ""),
                    "reference": src.get("reference", ""),
                },
            },
        })

    for src in getattr(toolkit, "sources_image", []):
        obj = src.get("object", {})
        content = obj.get("content", {})
        components.append({
            "type": "citation",
            "data": {
                "parent_id": "",
                "image_source": {
                    "type": "image",
                    "path": content.get("path", ""),
                    "page": str(content.get("page", "")),
                    "file_name": content.get("file_name", ""),
                    "external_id": content.get("external_id", ""),
                    "workspace_id": content.get("brain_id", ""),
                    "height": str(content.get("height", "")),
                    "width": str(content.get("width", "")),
                    "reference": src.get("reference", ""),
                },
            },
        })

    return components


def _create_search_tools(
    tool_configs: list,
    doc_tree: list,
    brain_tree: list,
    brain_ids: list,
    top_k: int,
    collector: ToolResultCollector,
    input_files: Optional[List[str]] = None,
) -> List[StructuredTool]:
    """Create document-search and brain-search LangChain tools.

    When input_files is provided (non-empty list), only the filtered search tool
    will be created, which restricts search to the specified document external_ids.
    """
    from src.smart_rag.tools import construct_json, generate_brain_tree_schema, SearchToolkit
    from src.config.settings import get_settings

    settings = get_settings()
    tools: List[StructuredTool] = []

    # When input_files is provided without doc_tree, skip schema construction
    # Filtered search works with just external_ids
    if doc_tree:
        doc_tree_copy = copy.deepcopy(doc_tree)
        schema, attribute_mapping, _ = construct_json(doc_tree_copy)
    elif input_files:
        # Filtered search mode - no schema needed
        schema, attribute_mapping = None, {}
    else:
        # No doc_tree and no input_files - can't create search tools
        return tools

    brain_schema, brain_attribute_mapping = None, None
    if brain_tree:
        brain_schema, brain_attribute_mapping, _ = generate_brain_tree_schema(brain_tree)

    # Build toolkit
    toolkit = SearchToolkit(
        task_order=None,
        brain_id=brain_ids,
        top_k=top_k,
        vectorstore=getattr(settings, "QDRANT_COLLECTION_NAME", "vectorstoredev2"),
        attribute_mapping=attribute_mapping or {},
        brain_attribute_mapping=brain_attribute_mapping or {},
        search_web="off",
    )

    # Track how many sources we've already collected so we only emit new ones
    # Must be defined before the input_files check so both paths can use it
    prev_text_count = 0
    prev_image_count = 0

    def _collect_new_citations():
        """Emit citation components only for sources added since the last call."""
        nonlocal prev_text_count, prev_image_count

        new_text = getattr(toolkit, "sources_text", [])[prev_text_count:]
        new_image = getattr(toolkit, "sources_image", [])[prev_image_count:]

        prev_text_count = len(getattr(toolkit, "sources_text", []))
        prev_image_count = len(getattr(toolkit, "sources_image", []))

        for src in new_text:
            obj = src.get("object", {})
            content = obj.get("content", {})
            collector.add_component("citation", {
                "parent_id": "",
                "text_source": {
                    "type": "text",
                    "source": content.get("source", ""),
                    "external_id": content.get("external_id", ""),
                    "page": str(content.get("page", "")),
                    "page_content": content.get("page_content", ""),
                    "workspace_id": content.get("brain_id", ""),
                    "reference": src.get("reference", ""),
                },
            })

        for src in new_image:
            obj = src.get("object", {})
            content = obj.get("content", {})
            collector.add_component("citation", {
                "parent_id": "",
                "image_source": {
                    "type": "image",
                    "path": content.get("path", ""),
                    "page": str(content.get("page", "")),
                    "file_name": content.get("file_name", ""),
                    "external_id": content.get("external_id", ""),
                    "workspace_id": content.get("brain_id", ""),
                    "height": str(content.get("height", "")),
                    "width": str(content.get("width", "")),
                    "reference": src.get("reference", ""),
                },
            })

    # When input_files is provided, only create filtered search tool
    if input_files:
        logger.info(
            "CREATING_FILTERED_SEARCH_TOOL",
            input_files_count=len(input_files),
        )
        async def _filtered_search(query: str) -> str:
            result = await toolkit.perform_filtered_search(query, input_files)
            _collect_new_citations()
            return _format_search_result(result)

        tools.append(StructuredTool(
            name="perform_filtered_search",
            description=(
                f"Search within specific documents from the knowledge base. "
                f"Restricted to {len(input_files)} document(s). "
                f"Use this to find information in the specified documents only."
            ),
            func=None,
            coroutine=_filtered_search,
            args_schema=SearchQueryInput,
        ))
        return tools

    # Document search tool
    if attribute_mapping:
        async def _document_search(query: str) -> str:
            result = await toolkit.perform_document_search(query)
            _collect_new_citations()
            return _format_search_result(result)

        tools.append(StructuredTool(
            name="perform_document_search",
            description=(
                "Search within specific documents from the knowledge base. "
                "Use this to find information in uploaded documents."
            ),
            func=None,
            coroutine=_document_search,
            args_schema=SearchQueryInput,
        ))

    # Brain search tool
    if brain_attribute_mapping:
        async def _brain_search(query: str, brain_name: str = None, document_filter: str = None) -> str:
            result = await toolkit.preform_all_brain_search(query, brain_name, document_filter)
            _collect_new_citations()
            return _format_search_result(result)

        tools.append(StructuredTool(
            name="preform_all_brain_search",
            description=(
                "Search across all knowledge bases (brains). "
                "Optionally filter by brain name or document."
            ),
            func=None,
            coroutine=_brain_search,
            args_schema=BrainSearchInput,
        ))

    # Standard search fallback (when no specific schema but we have brain_ids)
    if not attribute_mapping and not brain_attribute_mapping:
        async def _standard_search(query: str) -> str:
            result = await toolkit.perform_standard_search(query)
            _collect_new_citations()
            return _format_search_result(result)

        tools.append(StructuredTool(
            name="perform_standard_search",
            description="Search all available documents.",
            func=None,
            coroutine=_standard_search,
            args_schema=SearchQueryInput,
        ))

    return tools


def _create_in_memory_tools(
    tool_configs: list,
    doc_tree: list,
    brain_ids: list,
    top_k: int,
) -> List[StructuredTool]:
    """Create in-memory extraction LangChain tool."""
    from src.smart_rag.tools import in_memory_construct_json, SearchToolkit
    from src.config.settings import get_settings

    settings = get_settings()

    # Get custom description from tool config
    in_memory_desc = _get_tool_description(tool_configs, "in_memory") or (
        "Retrieve the full content of a specific file loaded in memory."
    )

    original_doc_tree = copy.deepcopy(doc_tree)
    inmemory_schema, inmemory_mapping, _ = in_memory_construct_json(
        original_doc_tree, in_memory_desc
    )

    if not inmemory_schema or not inmemory_mapping:
        return []

    toolkit = SearchToolkit(
        task_order=None,
        brain_id=brain_ids,
        top_k=top_k,
        vectorstore=getattr(settings, "QDRANT_COLLECTION_NAME", "vectorstoredev2"),
        search_web="off",
    )
    toolkit.set_in_memory_documents(copy.deepcopy(doc_tree))

    async def _in_memory_extraction(file_name: str) -> str:
        return await toolkit.perform_in_memory_extraction(file_name)

    return [StructuredTool(
        name="perform_in_memory_extraction",
        description=in_memory_desc,
        func=None,
        coroutine=_in_memory_extraction,
        args_schema=InMemoryInput,
    )]


def _create_calculator_tool() -> StructuredTool:
    """Create a calculator LangChain tool."""
    from src.smart_rag.tools import calculator

    async def _calc(expression: str) -> str:
        return await calculator(expression)

    return StructuredTool(
        name="calculator",
        description="Evaluate arithmetic expressions safely. Supports: +, -, *, /, **, %, sqrt().",
        func=None,
        coroutine=_calc,
        args_schema=CalculatorInput,
    )


def _create_web_search_tool(brain_ids: list, collector: ToolResultCollector) -> Optional[StructuredTool]:
    """Create a web search LangChain tool."""
    from src.smart_rag.tools import SearchToolkit

    toolkit = SearchToolkit(
        task_order=None,
        brain_id=brain_ids or [],
        top_k=4,
        search_web="standard",
    )

    if not toolkit.web_search_tool:
        logger.warning("Web search tool could not be initialized (no API key?)")
        return None

    async def _web_search(query: str) -> str:
        result = await toolkit.perform_web_search(query)
        # Collect sources component
        sources = result.get("sources", [])
        if sources:
            collector.add_component("sources", {
                "sources": [
                    {"title": s.get("title", ""), "url": s.get("url", "")}
                    for s in sources
                ],
            })
        return result.get("text", str(result))

    return StructuredTool(
        name="perform_web_search",
        description="Search the web for current information. Returns text results with sources.",
        func=None,
        coroutine=_web_search,
        args_schema=WebSearchInput,
    )


def _create_code_interpreter_tool(
    agent_config: dict,
    brain_ids: list,
    brain_documents: list,
    collector: ToolResultCollector,
) -> Optional[StructuredTool]:
    """Create a code interpreter LangChain tool.

    Wraps the backend sandbox call directly, bypassing Google ADK ToolContext
    by injecting session params from the agent config.
    """
    import asyncio
    import base64
    import json
    import requests
    from src.config.settings import get_settings

    settings = get_settings()
    backend_url = getattr(settings, "CODE_INTERPRETER_BACKEND_URL", None)
    available_filenames = _format_available_filenames(brain_documents)

    if not backend_url:
        logger.warning("Code interpreter backend URL not configured, skipping tool")
        return None

    # Pre-compute v2 file_paths payload expected by the sandbox backend
    file_paths_base64 = None
    if brain_documents:
        file_paths_list = [
            {"azure_path": doc.get("filepath", ""), "filename": doc.get("filename", "")}
            for doc in brain_documents
            if doc.get("filepath") and doc.get("filename")
        ]
        if file_paths_list:
            file_paths_base64 = base64.b64encode(
                json.dumps(file_paths_list).encode("utf-8")
            ).decode("utf-8")

    # Extract session params from agent_params if available
    agent_params = agent_config.get("agent_params") or {}
    session_id = agent_params.get("session_id")
    user_id = agent_params.get("user_id")
    brain_id = brain_ids[0] if brain_ids else None

    async def _run_code(code: str, timeout_seconds: int = 60) -> str:
        timeout_seconds = min(timeout_seconds, 300)

        if not brain_id:
            return "Error: Code interpreter requires at least one workspace/brain context"
        if not user_id:
            return "Error: Code interpreter requires a user_id in agent_params"
        if not session_id:
            return "Error: Code interpreter requires a session_id in agent_params"

        try:
            response = await asyncio.to_thread(
                requests.post,
                f"{backend_url}/tool/python_interpreter_v2",
                json={
                    "user_id": user_id,
                    "workspace_id": brain_id,
                    "session_id": session_id,
                    "code": code,
                    "timeout_seconds": timeout_seconds,
                    "file_paths": file_paths_base64,
                },
                timeout=timeout_seconds + 15,
            )
            response.raise_for_status()
            result = response.json()

            stdout = result.get("stdout", "")
            stderr = result.get("stderr", "")

            # Collect sandbox component
            collector.add_component("sandbox", {
                "code": code,
                "output": stdout,
                "error": stderr,
                "output_available": True,
            })

            # Collect artifact components for generated files
            for gf in result.get("generated_files", []):
                collector.add_component("artifact", {
                    "file_path": gf.get("azure_path", gf.get("file_path", "")),
                    "filename": gf.get("filename", gf.get("name", "")),
                })

            # Build text response for the LLM
            output = []
            status = result.get("status", {})
            if status.get("id") == 3:
                output.append("Execution successful\n")
            else:
                output.append(f"Error: {status.get('description', 'Unknown')}\n")

            if stdout:
                output.append(f"```\n{stdout}\n```\n")
            if stderr:
                output.append(f"Errors:\n```\n{stderr}\n```\n")
            if result.get("time"):
                output.append(f"\nExecution time: {result['time']}s")

            return "\n".join(output)

        except requests.exceptions.Timeout:
            return f"Error: Code execution timed out after {timeout_seconds} seconds"
        except requests.exceptions.RequestException as e:
            response = getattr(e, "response", None)
            details = f" | backend body: {response.text[:500]}" if response is not None and response.text else ""
            return f"Error: Failed to connect to sandbox backend: {e}{details}"
        except Exception as e:
            return f"Error: {e}"

    return StructuredTool(
        name="python_interpreter",
        description=(
            "Execute Python 3 code in an isolated sandbox. "
            "Use for data analysis, calculations, file processing, and visualization. "
            "Workspace documents are mounted into the execution workspace, and generated files "
            "(CSV, images, reports, PDFs) are automatically saved. "
            "Do not ask the user to upload workspace documents again; use the files already available in the sandbox."
            + (f" Available workspace files: {available_filenames}." if available_filenames else "")
        ),
        func=None,
        coroutine=_run_code,
        args_schema=CodeInterpreterInput,
    )


def _create_plan_tool() -> StructuredTool:
    """Create a plan generator LangChain tool."""
    from src.smart_rag.tools.utilities.plan_generator import generate_execution_plan

    async def _plan(title: str, steps: str) -> str:
        return await generate_execution_plan(title, steps)

    return StructuredTool(
        name="generate_execution_plan",
        description=(
            "Generate an execution plan with task-agent assignments. "
            "Takes a title and a JSON string of steps (each with 'task' and 'agent' fields)."
        ),
        func=None,
        coroutine=_plan,
        args_schema=PlanGeneratorInput,
    )


def _format_search_result(result: Dict[str, Any]) -> str:
    """Format a SearchToolkit result dict into a readable string for the LLM."""
    if not result:
        return "No results found."

    parts = []
    sources_text = result.get("sources_text", [])
    if sources_text:
        for i, source in enumerate(sources_text, 1):
            if isinstance(source, dict):
                text = source.get("text", source.get("content", str(source)))
                filename = source.get("filename", source.get("source", ""))
                header = f"[Source {i}: {filename}]" if filename else f"[Source {i}]"
                parts.append(f"{header}\n{text}")
            else:
                parts.append(f"[Source {i}]\n{source}")

    if not parts:
        return "No relevant results found."

    return "\n\n---\n\n".join(parts)

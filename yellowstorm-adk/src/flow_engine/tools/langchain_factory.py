"""Factory for creating LangChain tools from playbook agent configurations.

Bridges the gap between playbook agent tool configs (name-based) and real
executable LangChain StructuredTool instances, reusing the same search
infrastructure as RunAgentTeam (SearchToolkit, build_tree, etc.).
"""

import contextvars
import copy
import json
import re
from typing import Dict, Any, List, Optional, Tuple, Type

# Carries the actual MCP args (after Python overrides) from _execute_mcp to step_tools
_last_mcp_actual_args: contextvars.ContextVar[dict] = contextvars.ContextVar(
    "_last_mcp_actual_args", default={}
)

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model
from structlog import get_logger

from src.config.settings import get_settings
from src.flow_engine.runtime.artifact_routing import (
    infer_artifact_kind,
    semantic_match_output_port,
)
from src.smart_rag.tools.utilities.code_interpreter_payload import (
    _extract_workspace_name_from_filepath,
    _extract_workspace_name_hint,
    build_code_interpreter_payload_context,
)
from src.smart_rag.tools.utilities.connector_tools import (
    import_connector_items_to_workspace_request,
)

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Workspace name resolver (brain_id ObjectId → actual workspace name)
# ---------------------------------------------------------------------------

_WORKSPACE_NAME_CACHE: Dict[str, str] = {}
_OBJECT_ID_RE = re.compile(r"^[0-9a-f]{24}$", re.IGNORECASE)


def _looks_like_object_id(value: str) -> bool:
    return bool(_OBJECT_ID_RE.match(value or ""))


async def _resolve_workspace_names(ids: List[str]) -> Dict[str, str]:
    """Resolve MongoDB ObjectIds to workspace names via the internal backend endpoint.

    Results are cached in-process for the lifetime of the worker.
    Unknown or failed IDs fall back to the original ID string.
    """
    settings = get_settings()
    raw_api_url = (getattr(settings, "API_URL", "") or "").rstrip("/")
    token = getattr(settings, "INTERNAL_SERVICE_SECRET", "") or ""

    if not raw_api_url or not token:
        return {}

    # Ensure the base URL includes the /api prefix used by NestJS
    if raw_api_url.endswith("/api") or raw_api_url.endswith("/api/v1"):
        api_base = raw_api_url.rsplit("/v1", 1)[0] if raw_api_url.endswith("/api/v1") else raw_api_url
    else:
        api_base = f"{raw_api_url}/api"

    unresolved = [i for i in ids if i not in _WORKSPACE_NAME_CACHE and _looks_like_object_id(i)]
    if unresolved:
        resolve_url = f"{api_base}/workspaces/internal/resolve-names"
        logger.info(
            "workspace_name_resolve_calling url=%s ids=%s",
            resolve_url,
            unresolved,
        )
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    resolve_url,
                    json={"ids": unresolved},
                    headers={"X-Internal-Token": token, "Content-Type": "application/json"},
                )
                logger.info(
                    "workspace_name_resolve_response status=%s url=%s",
                    resp.status_code,
                    resolve_url,
                )
                if resp.status_code == 200:
                    body = resp.json()
                    # Unwrap NestJS standard envelope {"success": true, "data": {...}, "meta": {...}}
                    if isinstance(body, dict) and "data" in body and isinstance(body["data"], dict):
                        data = body["data"]
                    elif isinstance(body, dict):
                        data = body
                    else:
                        data = {}
                    if data:
                        _WORKSPACE_NAME_CACHE.update({k: v for k, v in data.items() if v})
                        logger.info(
                            "workspace_names_resolved count=%s mapping=%s",
                            len(data),
                            data,
                        )
                else:
                    logger.warning(
                        "workspace_name_resolve_failed status=%s url=%s body=%s",
                        resp.status_code,
                        resolve_url,
                        resp.text[:200],
                    )
        except Exception as exc:
            logger.warning("workspace_name_resolve_error error=%s", str(exc))

    return {i: _WORKSPACE_NAME_CACHE.get(i, i) for i in ids}


def _log_payload(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str, indent=2)
    except (TypeError, ValueError):
        return str(value)


def _is_locate_answer_citations_tool(tool_name: str) -> bool:
    return "locate_answer_citations" in str(tool_name or "")


def _strip_legacy_citation_fields(response: Dict[str, Any]) -> Dict[str, Any]:
    stripped = dict(response)
    stripped.pop("citation_sources", None)
    stripped.pop("citations", None)
    stripped.pop("sources", None)
    return stripped


def _loggable_connector_payload(tool_name: str, payload: Any) -> Any:
    if _is_locate_answer_citations_tool(tool_name):
        return payload
    return "[non-locator MCP response omitted]"

# --- ToolResultCollector ---


class ToolResultCollector:
    """Collects structured components from tool executions.

    Shared between all tools of a single agent so the agentic loop
    can drain components after each tool call.
    """

    def __init__(self, initial_components: Optional[List[dict]] = None):
        self.components: List[dict] = []
        self._connector_source_signatures: Dict[str, str] = {}
        self._connector_source_links_seen: set[tuple[str, str]] = set()
        self._connector_reference_counter = 0
        self.seed_from_components(initial_components or [])

    def add_component(self, component_type: str, data: dict):
        self.components.append({"type": component_type, "data": data})

    def get_and_clear(self) -> List[dict]:
        result = list(self.components)
        self.components.clear()
        return result

    def next_connector_reference(self) -> str:
        self._connector_reference_counter += 1
        return str(self._connector_reference_counter)

    def seed_from_components(self, components: List[dict]) -> None:
        for component in components or []:
            if not isinstance(component, dict):
                continue

            component_type = component.get("type")
            data = component.get("data") or {}
            if component_type == "sources":
                for source in data.get("sources") or []:
                    if not isinstance(source, dict):
                        continue
                    title = str(source.get("title") or source.get("url") or "").strip()
                    url = str(source.get("url") or "").strip()
                    if title and url:
                        self._connector_source_links_seen.add((title, url))
                continue

            if component_type != "citation":
                continue

            source = _component_to_connector_citation_source(component)
            if not source:
                continue
            reference = _format_reference_marker(source.get("reference", ""))
            if not reference:
                continue

            self._connector_source_signatures[
                _build_connector_citation_signature(source)
            ] = reference
            reference_number = _parse_reference_number(reference)
            if reference_number is not None:
                self._connector_reference_counter = max(
                    self._connector_reference_counter,
                    reference_number,
                )


def _parse_reference_number(reference: str) -> Optional[int]:
    match = re.search(r"\d+", str(reference or ""))
    if not match:
        return None
    return int(match.group(0))


def _normalize_reference_token(value: Any) -> str:
    text = str(value or "").strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1].strip()
    return text


def _format_reference_marker(value: Any) -> str:
    reference = _normalize_reference_token(value)
    return f"[{reference}]" if reference else ""


def _reference_number(value: Any) -> int:
    reference = _normalize_reference_token(value)
    return int(reference) if reference.isdigit() else 0


def _component_to_connector_citation_source(
    component: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    data = component.get("data") or {}
    text_source = data.get("text_source")
    if isinstance(text_source, dict):
        return {
            "type": "text",
            "source": str(text_source.get("source") or ""),
            "file_name": str(text_source.get("file_name") or ""),
            "page": str(text_source.get("page") or ""),
            "page_content": str(text_source.get("page_content") or ""),
            "workspace_id": str(text_source.get("workspace_id") or ""),
            "workspace_name": str(
                text_source.get("workspace_name")
                or text_source.get("workspace_id")
                or ""
            ),
            "reference": str(text_source.get("reference") or ""),
        }

    image_source = data.get("image_source")
    if isinstance(image_source, dict):
        return {
            "type": "image",
            "path": str(image_source.get("path") or ""),
            "workspace_name": str(image_source.get("workspace_name") or ""),
            "page": str(image_source.get("page") or ""),
            "file_name": str(image_source.get("file_name") or ""),
            "workspace_id": str(image_source.get("workspace_id") or ""),
            "height": str(image_source.get("height") or ""),
            "width": str(image_source.get("width") or ""),
            "reference": str(image_source.get("reference") or ""),
        }

    return None


def _append_citation_guidance(text: str, references: List[str]) -> str:
    if not text or not references:
        return text

    refs = ", ".join(_format_reference_marker(ref) for ref in references)
    return f"{text}\n\nUse citation {refs} when referencing facts from this connector result."


def _build_connector_citation_signature(source: Dict[str, Any]) -> str:
    source_type = str(source.get("type") or "text")
    if source_type == "image":
        parts = [
            source_type,
            str(source.get("path") or ""),
            str(source.get("workspace_name") or ""),
            str(source.get("page") or ""),
        ]
    else:
        parts = [
            source_type,
            str(source.get("source") or ""),
            str(source.get("file_name") or ""),
            str(source.get("page") or ""),
            str(source.get("page_content") or ""),
        ]
    return "::".join(parts)


def _normalize_connector_citation_source(source: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(source)
    normalized["type"] = str(normalized.get("type") or "text")

    if not normalized.get("page") and "page_number" in normalized:
        normalized["page"] = normalized.get("page_number")
    if "page" in normalized:
        normalized["page"] = str(normalized.get("page") or "")

    highlight_text = normalized.get("highlight_text") or normalized.get("highlightText")
    if highlight_text and not normalized.get("page_content"):
        normalized["page_content"] = highlight_text
    if highlight_text:
        normalized["highlight_text"] = str(highlight_text)
        normalized["page_content"] = str(normalized.get("page_content") or "")

    if "highlight_bbox" not in normalized and "highlightBBox" in normalized:
        normalized["highlight_bbox"] = normalized.get("highlightBBox")
    if "block_bbox" not in normalized and "blockBBox" in normalized:
        normalized["block_bbox"] = normalized.get("blockBBox")

    if normalized["type"] != "image" and not normalized.get("source"):
        normalized["source"] = normalized.get("path") or ""

    if not normalized.get("file_name"):
        normalized["file_name"] = (
            normalized.get("filename")
            or normalized.get("fileName")
            or ""
        )

    return normalized


def _compact_citation_source(source: Dict[str, Any]) -> Dict[str, Any]:
    keys = (
        "type",
        "source",
        "path",
        "file_name",
        "page",
        "page_content",
        "workspace_id",
        "workspace_name",
        "reference",
        "highlight_text",
        "highlight_bbox",
        "block_bbox",
    )
    return {
        key: source[key]
        for key in keys
        if key in source and source[key] not in ("", None)
    }


def _collect_connector_response_components(
    collector: ToolResultCollector,
    response: Any,
    tool_name: str = "",
) -> Any:
    if not isinstance(response, dict):
        return response

    is_located_answer_citations = _is_locate_answer_citations_tool(tool_name)
    normalized_response = (
        dict(response)
        if is_located_answer_citations
        else _strip_legacy_citation_fields(response)
    )
    logger.info(
        "playbook_connector_component_collection_start response_keys=%s source_count=%s citation_source_count=%s response=%s",
        sorted(normalized_response.keys()),
        len(normalized_response.get("sources", []))
        if isinstance(normalized_response.get("sources"), list)
        else 0,
        len(normalized_response.get("citation_sources", []))
        if isinstance(normalized_response.get("citation_sources"), list)
        else 0,
        _log_payload(_loggable_connector_payload(tool_name, normalized_response)),
    )

    sources = normalized_response.get("sources") if is_located_answer_citations else None
    if isinstance(sources, list):
        new_sources: List[Dict[str, str]] = []
        for source in sources:
            if not isinstance(source, dict):
                continue
            title = str(source.get("title") or source.get("url") or "").strip()
            url = str(source.get("url") or "").strip()
            if not url:
                continue
            signature = (title, url)
            if signature in collector._connector_source_links_seen:
                logger.info(
                    "playbook_connector_source_reused title=%s url=%s",
                    title,
                    url,
                )
                continue
            collector._connector_source_links_seen.add(signature)
            new_sources.append({"title": title, "url": url})
        if new_sources:
            collector.add_component("sources", {"sources": new_sources})
            logger.info(
                "playbook_connector_sources_component_emitted count=%s sources=%s",
                len(new_sources),
                _log_payload(new_sources),
            )

    citation_sources = normalized_response.get("citation_sources")
    if not isinstance(citation_sources, list):
        citation_sources = normalized_response.get("citations")
    if not isinstance(citation_sources, list):
        return normalized_response

    assigned_references: List[str] = []
    normalized_citation_sources: List[Dict[str, Any]] = []

    for raw_source in citation_sources:
        if not isinstance(raw_source, dict):
            continue

        source = _normalize_connector_citation_source(raw_source)
        if is_located_answer_citations:
            source["citation_origin"] = "locate_answer_citations"
        source_type = str(source.get("type") or "text")
        if source_type != "image":
            workspace_id = str(source.get("workspace_id") or "").strip()
            source["workspace_name"] = str(
                source.get("workspace_name") or workspace_id
            ).strip()
        signature = _build_connector_citation_signature(source)
        reference = collector._connector_source_signatures.get(signature)
        is_new_source = reference is None
        if reference is None:
            reference = _format_reference_marker(source.get("reference"))
            if reference:
                collector._connector_reference_counter = max(
                    collector._connector_reference_counter,
                    _reference_number(reference),
                )
            else:
                reference = _format_reference_marker(collector.next_connector_reference())
            collector._connector_source_signatures[signature] = reference
            ref_val = source.get("file_name") if source.get("type") == "text" else source.get("workspace_name") or ""
            logger.warning(
                "PLAYBOOK_MCP_CITATION_REGISTERED reference=%s source_type=%s source=%s ref_val=%s page=%s raw_source=%s",
                reference,
                source.get("type", "text"),
                source.get("source") or source.get("path") or "",
                ref_val,
                source.get("page") or "",
                _log_payload(source),
            )
        else:
            ref_val = source.get("file_name") if source.get("type") == "text" else source.get("workspace_name") or ""
            logger.warning(
                "PLAYBOOK_MCP_CITATION_REUSED reference=%s source_type=%s source=%s ref_val=%s page=%s raw_source=%s",
                reference,
                source.get("type", "text"),
                source.get("source") or source.get("path") or "",
                ref_val,
                source.get("page") or "",
                _log_payload(source),
            )
        source["reference"] = reference
        normalized_citation_sources.append(_compact_citation_source(source))
        assigned_references.append(reference)

        if not is_new_source:
            continue

        if source_type == "image":
            component_payload = {
                "parent_id": "",
                "image_source": {
                    "type": "image",
                    "path": str(source.get("path") or ""),
                    "page": str(source.get("page") or ""),
                    "file_name": str(source.get("file_name") or ""),
                    "workspace_name": str(source.get("workspace_name") or ""),
                    "workspace_id": str(source.get("workspace_id") or ""),
                    "height": str(source.get("height") or ""),
                    "width": str(source.get("width") or ""),
                    "reference": reference,
                },
            }
            if source.get("citation_origin"):
                component_payload["citation_origin"] = source.get("citation_origin")
            collector.add_component(
                "citation",
                component_payload,
            )
        else:
            text_source = {
                "type": "text",
                "source": str(source.get("source") or ""),
                "page": str(source.get("page") or ""),
                "page_content": str(source.get("page_content") or ""),
                "reference": reference,
            }
            if source.get("file_name"):
                text_source["file_name"] = str(source.get("file_name") or "")
            if source.get("workspace_id"):
                text_source["workspace_id"] = str(source.get("workspace_id") or "")
            if source.get("workspace_name"):
                text_source["workspace_name"] = str(source.get("workspace_name") or "")
            if source.get("highlight_text"):
                text_source["highlight_text"] = str(source.get("highlight_text") or "")
            if source.get("highlight_bbox"):
                text_source["highlight_bbox"] = source.get("highlight_bbox")
            if source.get("block_bbox"):
                text_source["block_bbox"] = source.get("block_bbox")
            text_source = _compact_citation_source(text_source)
            component_payload = {
                "parent_id": "",
                "text_source": text_source,
            }
            if source.get("citation_origin"):
                component_payload["citation_origin"] = source.get("citation_origin")
            collector.add_component(
                "citation",
                component_payload,
            )
        logger.warning(
            "PLAYBOOK_MCP_CITATION_COMPONENT_EMITTED reference=%s source_type=%s component=%s",
            reference,
            source_type,
            _log_payload(component_payload),
        )

    if normalized_citation_sources:
        normalized_response["citation_sources"] = normalized_citation_sources
        text = normalized_response.get("text")
        if isinstance(text, str):
            normalized_response["text"] = _append_citation_guidance(
                text,
                assigned_references,
            )
        logger.warning(
            "PLAYBOOK_MCP_CITATION_COLLECTION_COMPLETE assigned_references=%s citation_sources=%s",
            assigned_references,
            _log_payload(normalized_citation_sources),
        )

    return normalized_response


# --- Pydantic schemas for tool inputs ---


class SearchQueryInput(BaseModel):
    query: str = Field(description="The search query string.")


class BrainSearchInput(BaseModel):
    query: str = Field(description="The search query string.")
    brain_name: Optional[str] = Field(
        default=None, description="Specific brain/workspace to search in."
    )
    document_filter: Optional[str] = Field(
        default=None, description="Filter by specific document."
    )


class InMemoryInput(BaseModel):
    file_name: str = Field(description="Name of the file to extract content from.")


class CalculatorInput(BaseModel):
    expression: str = Field(
        description="Mathematical expression to evaluate. Supports: +, -, *, /, **, %, sqrt()."
    )


class WebSearchInput(BaseModel):
    query: str = Field(description="The web search query.")


class CodeInterpreterInput(BaseModel):
    code: str = Field(description="Python 3 code to execute in an isolated sandbox.")
    timeout_seconds: int = Field(
        default=60, description="Maximum execution time in seconds (max 300)."
    )


class PlanGeneratorInput(BaseModel):
    title: str = Field(description="Title of the execution plan.")
    steps: str = Field(
        description=(
            "JSON string containing an array of step objects. "
            "Each step must have 'task' and 'agent' fields. "
            'Example: \'[{"task": "Search docs", "agent": "search_agent"}]\''
        )
    )


class ActivateSkillInput(BaseModel):
    name: str = Field(description="The exact skill name to activate.")


class ConnectorImportInput(BaseModel):
    mode: str = Field(
        description="Import mode: 'file', 'files', or 'folder'.",
    )
    drive_id: Optional[str] = Field(
        default=None,
        description="Optional direct drive ID for simple file or folder import calls.",
    )
    item_id: Optional[str] = Field(
        default=None,
        description="Optional direct item ID for simple file or folder import calls.",
    )
    path: Optional[str] = Field(
        default=None,
        description="Optional direct path for simple file or folder import calls when item_id is not available.",
    )
    item_ref: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Single connector item reference for file or folder import.",
    )
    item_refs: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Multiple connector item references for batch file import.",
    )
    recursive: bool = Field(
        default=True,
        description="Recursively import folder contents when mode is 'folder'.",
    )


def create_langchain_tools(
    agent_config: dict,
    workspace_context: Optional[list] = None,
    file_names: Optional[List[str]] = None,
    input_files: Optional[List[str]] = None,
    documents_by_port: Optional[Dict[str, List[str]]] = None,
    code_interpreter_files: Optional[List[Dict[str, str]]] = None,
    output_ports: Optional[List[Dict[str, Any]]] = None,
    output_workspace_id: str = "",
    workspace_context_mode: str = "resolved_inputs_only",
    step_connector_bindings: Optional[List[Dict[str, Any]]] = None,
    initial_components: Optional[List[dict]] = None,
    user_id: Optional[str] = None,
    workspace_ceph_paths: Optional[List[str]] = None,
) -> Tuple[List[StructuredTool], ToolResultCollector]:
    """Create LangChain StructuredTool instances from a playbook agent config.

    Args:
        agent_config: Agent dict with keys like tools, brain_ids, brain_documents.
        workspace_context: Optional workspace context list (from gRPC request).
        file_names: Optional list of file names to restrict search to.
        documents_by_port: Optional mapping of input port id to file names.
        code_interpreter_files: Optional list of resolved files to mount in the sandbox.
        output_workspace_id: Workspace used for generated file uploads.
        workspace_context_mode: Indicates whether the current task relies on fallback workspace context.
        step_connector_bindings: Optional list of connector bindings attached to this step.
        initial_components: Prior playbook source/citation components used to continue
            citation numbering and avoid duplicate source emission.

    Returns:
        Tuple of (list of StructuredTools, ToolResultCollector).
    """
    collector = ToolResultCollector(initial_components=initial_components)
    effective_file_names = file_names if file_names is not None else input_files
    agent_params = agent_config.get("agent_params") or {}
    session_id = str(agent_params.get("session_id") or "")
    user_id = str(agent_params.get("user_id") or "")
    # Prefer the authoritative Ceph paths ("user_id/workspace_name") resolved by the
    # step node from the backend payload. Fall back to deriving them from document
    # filepaths only when the backend did not supply explicit paths.
    workspace_paths = list(workspace_ceph_paths or [])
    if not workspace_paths:
        workspace_paths = _collect_workspace_paths(
            workspace_context, code_interpreter_files, user_id
        )

    # --- Connector MCP tools (always evaluated, even if agent has no native tools) ---
    mcp_tools: List[StructuredTool] = []
    if step_connector_bindings:
        # Use raw workspace IDs directly (brain_ids), with fallback to output_workspace_id
        raw_ids = agent_config.get("brain_ids") or []
        connector_workspace_ids = (
            raw_ids
            or [
                wc.get("workspace_id")
                for wc in (workspace_context or [])
                if isinstance(wc, dict) and wc.get("workspace_id")
            ]
        )
        if not connector_workspace_ids and output_workspace_id:
            connector_workspace_ids = [output_workspace_id]
        mcp_tools = _create_connector_mcp_tools(
            step_connector_bindings,
            collector,
            output_workspace_id=output_workspace_id,
            workspace_ids=connector_workspace_ids,
            file_names=effective_file_names,
            user_id=user_id,
            external_ids=input_files,
            session_id=session_id,
            workspace_paths=workspace_paths,
        )

    # --- Platform tools (e.g. save_file_to_workspace) ---
    platform_tools = _create_platform_tools(agent_config, collector)
    mcp_tools.extend(platform_tools)

    tool_configs = agent_config.get("tools", [])

    # If agent has no native tools, return only connector MCP tools
    if not tool_configs:
        logger.info(
            "Created LangChain tools for playbook agent (connectors only)",
            agent=agent_config.get("name"),
            tool_count=len(mcp_tools),
            tool_names=[t.name for t in mcp_tools],
        )
        return mcp_tools, collector

    tool_names = {
        t["name"] for t in tool_configs if isinstance(t, dict) and t.get("name")
    }
    if not tool_names:
        logger.info(
            "Created LangChain tools for playbook agent (connectors only, empty tool configs)",
            agent=agent_config.get("name"),
            tool_count=len(mcp_tools),
            tool_names=[t.name for t in mcp_tools],
        )
        return mcp_tools, collector

    tools: List[StructuredTool] = list(mcp_tools)

    # Merge workspace context into agent brain data
    workspace_names, brain_documents = _merge_brain_data(agent_config, workspace_context)

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
    # Search tools can be created with doc_tree if available, or with file_names for filtered search
    if "search" in tool_names and (doc_tree or effective_file_names):
        search_tools = _create_search_tools(
            tool_configs,
            doc_tree,
            brain_tree,
            workspace_names,
            top_k,
            collector,
            file_names=effective_file_names,
            documents_by_port=documents_by_port,
            user_id=user_id,
        )
        tools.extend(search_tools)

    # --- In-memory tool ---
    if "in_memory" in tool_names and doc_tree:
        in_memory_tools = _create_in_memory_tools(
            tool_configs, doc_tree, workspace_names, top_k
        )
        tools.extend(in_memory_tools)

    # --- Calculator ---
    if "calculator" in tool_names:
        tools.append(_create_calculator_tool())

    # --- Web search ---
    if "search_web" in tool_names:
        web_tool = _create_web_search_tool(workspace_names, collector)
        if web_tool:
            tools.append(web_tool)

    # --- Code interpreter ---
    if "code interpreter" in tool_names:
        if not output_workspace_id:
            raise ValueError("Code interpreter requires a default playbook workspace")
        code_tool = _create_code_interpreter_tool(
            agent_config,
            workspace_names,
            code_interpreter_files or brain_documents,
            collector,
            output_ports=output_ports,
            documents_by_port=documents_by_port,
            output_workspace_id=output_workspace_id,
            workspace_context_mode=workspace_context_mode,
        )
        if code_tool:
            tools.append(code_tool)

    # --- Plan generator ---
    if "plan" in tool_names:
        tools.append(_create_plan_tool())

    if agent_config.get("skills"):
        activate_skill_tool = _create_activate_skill_tool(
            agent_config.get("skills") or []
        )
        if activate_skill_tool:
            tools.append(activate_skill_tool)

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


def _json_schema_type_to_python(schema: Dict[str, Any]) -> Any:
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        schema_type = next((item for item in schema_type if item != "null"), "string")
    if schema_type == "string":
        return str
    if schema_type == "integer":
        return int
    if schema_type == "number":
        return float
    if schema_type == "boolean":
        return bool
    if schema_type == "array":
        return List[Any]
    if schema_type == "object":
        return Dict[str, Any]
    return Any


def _build_args_schema_for_connector_tool(
    tool_name: str,
    parameter_schema: Dict[str, Any],
) -> Any:
    properties = (
        parameter_schema.get("properties")
        if isinstance(parameter_schema, dict)
        else None
    )
    required = (
        set(parameter_schema.get("required") or [])
        if isinstance(parameter_schema, dict)
        else set()
    )
    if not isinstance(properties, dict) or not properties:
        return create_model(
            f"{tool_name}Input",
            params=(
                Dict[str, Any],
                Field(
                    default_factory=dict,
                    description="Parameters for the connector action. Override fixed params as needed.",
                ),
            ),
        )

    field_defs: Dict[str, Any] = {}
    for prop_name, prop_schema in properties.items():
        prop_schema = prop_schema if isinstance(prop_schema, dict) else {}
        py_type = _json_schema_type_to_python(prop_schema)
        description = prop_schema.get("description") or ""
        if prop_name in required:
            field_defs[prop_name] = (py_type, Field(..., description=description))
        else:
            default = prop_schema.get("default", None)
            field_defs[prop_name] = (
                Optional[py_type],
                Field(default=default, description=description),
            )

    return create_model(f"{tool_name}Input", **field_defs)


def _collect_workspace_paths(
    workspace_context: Optional[list],
    code_interpreter_files: Optional[List[Dict[str, str]]] = None,
    user_id: Optional[str] = None,
) -> List[str]:
    """Derive the sandbox workspace folder names sent to the MCP connector.

    Each workspace becomes a folder under /mnt/workspace/<name> inside the sandbox VM.
    Names are derived from the document's workspace_name (or its filepath), matching the
    convention used by the code interpreter. Both the resolved input-port files
    (code_interpreter_files) and the playbook-level workspace_context are inspected,
    since the active source depends on how the workspace was wired to the step.
    """
    names: List[str] = []
    seen = set()

    def _add(name: str) -> None:
        name = (name or "").strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)

    # 1) Resolved input-port files (resolved_inputs_only mode).
    for doc in code_interpreter_files or []:
        if not isinstance(doc, dict):
            continue
        _add(
            _extract_workspace_name_hint(str(doc.get("workspace_name", "")).strip())
            or _extract_workspace_name_from_filepath(
                str(doc.get("filepath", "")),
                workspace_id=str(doc.get("workspace_id", "")).strip(),
                owner_user_id=user_id,
            )
        )

    # 2) Playbook-level workspace context (fallback_playbook mode).
    for wc in workspace_context or []:
        if not isinstance(wc, dict):
            continue
        for doc in wc.get("documents", []):
            if not isinstance(doc, dict):
                continue
            _add(
                _extract_workspace_name_hint(str(doc.get("workspace_name", "")).strip())
                or _extract_workspace_name_from_filepath(
                    str(doc.get("filepath", "")),
                    workspace_id=str(doc.get("workspace_id", "")).strip(),
                    owner_user_id=user_id,
                )
            )

    return names


def _merge_brain_data(agent_config: dict, workspace_context: Optional[list]) -> tuple:
    """Merge agent workspace_names/brain_documents with workspace_context."""
    workspace_names = list(agent_config.get("brain_ids") or [])
    brain_documents = list(agent_config.get("brain_documents") or [])

    if workspace_context:
        for wc in workspace_context:
            wid = wc.get("workspace_id")
            workspace_name = wc.get("workspace_name") or wid
            if workspace_name and workspace_name not in workspace_names:
                workspace_names.append(workspace_name)
            for doc in wc.get("documents", []):
                brain_documents.append(
                    {
                        "_id": doc.get("id", doc.get("_id", "")),
                        "filename": doc.get("filename", ""),
                        "file_name": doc.get("file_name") or doc.get("filename", ""),
                        "filepath": doc.get("filepath", ""),
                        "workspace_id": doc.get("workspace_id", wid or ""),
                        "workspace_name": doc.get("workspace_name") or workspace_name or "",
                    }
                )

    return workspace_names, brain_documents


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


def _create_activate_skill_tool(
    skills: List[Dict[str, Any]],
) -> Optional[StructuredTool]:
    skill_map = {
        str(skill.get("name") or "").strip(): skill
        for skill in skills
        if isinstance(skill, dict) and str(skill.get("name") or "").strip()
    }
    if not skill_map:
        return None

    def _activate_skill(name: str) -> str:
        skill = skill_map.get((name or "").strip())
        if not skill:
            available = ", ".join(sorted(skill_map.keys()))
            return f"Skill '{name}' is not available. Available skills: {available}"

        instructions = str(skill.get("instructions") or "").strip()
        return (
            f'<skill_content name="{skill["name"]}">\n{instructions}\n</skill_content>'
        )

    return StructuredTool.from_function(
        func=_activate_skill,
        name="activate_skill",
        description="Load the full instructions for a configured skill by name before completing a matching task.",
        args_schema=ActivateSkillInput,
    )


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


def _is_sandbox_local_path(path: str) -> bool:
    normalized = str(path or "").strip().lower()
    return normalized.startswith("/box/") or normalized.startswith("sandbox:/box/")


def _select_generated_artifact_output_port(
    output_ports: Optional[List[Dict[str, Any]]],
    filename: str,
    inferred_kind: str = "",
) -> Optional[Dict[str, Any]]:
    """Select the declared file-capable output port for a generated file.

    When only one non-text/code port exists, that port wins even if the file
    extension suggests a different kind. This keeps tool-generated files routed
    to the task's only file output instead of failing on filename inference.
    """
    ports = [
        port
        for port in (output_ports or [])
        if str(port.get("artifact_kind") or "").strip() not in {"text", "code"}
    ]
    if len(ports) == 1:
        return ports[0]
    selected_port = semantic_match_output_port(
        ports,
        preferred_kind=inferred_kind,
        filename=filename,
        label=f"generated artifact '{filename}'",
        allow_single_compatible=True,
    )
    if selected_port is not None:
        return selected_port

    # Keep a deterministic fallback for tool-generated files when multiple
    # file-capable ports exist but semantic cues are weak.
    return next(
        (port for port in ports if str(port.get("id") or "").strip() == "default"),
        None,
    )


def _build_code_interpreter_file_list(
    code_interpreter_files: Optional[List[Dict[str, str]]],
) -> List[Dict[str, str]]:
    deduped_by_filename: Dict[str, Dict[str, str]] = {}

    for doc in code_interpreter_files or []:
        filepath = str(doc.get("filepath", "")).strip()
        filename = str(doc.get("filename", "")).strip()
        workspace_id = str(doc.get("workspace_id", "")).strip()
        workspace_name = str(doc.get("workspace_name", "")).strip()
        if not filepath or not filename:
            continue

        existing = deduped_by_filename.get(filename)
        current_is_local = _is_sandbox_local_path(filepath)
        existing_is_local = (
            _is_sandbox_local_path(existing.get("filepath", "")) if existing else False
        )

        if existing is None or (existing_is_local and not current_is_local):
            deduped_by_filename[filename] = {
                "filepath": filepath,
                "filename": filename,
                "workspace_id": workspace_id,
                "workspace_name": workspace_name,
            }

    return [
        entry
        for entry in deduped_by_filename.values()
        if not _is_sandbox_local_path(entry.get("filepath", ""))
    ]


def _resolve_code_interpreter_workspace_name(
    files: List[Dict[str, str]],
    user_id: Optional[str],
) -> str:
    workspace_names = {
        _extract_workspace_name_hint(str(doc.get("workspace_name", "")).strip())
        or _extract_workspace_name_from_filepath(
            str(doc.get("filepath", "")),
            workspace_id=str(doc.get("workspace_id", "")).strip(),
            owner_user_id=user_id,
        )
        for doc in files
        if (
            str(doc.get("workspace_name", "")).strip()
            or str(doc.get("filepath", "")).strip()
        )
    }
    workspace_names.discard("")
    if len(workspace_names) == 1:
        return next(iter(workspace_names))
    return ""


def _normalize_code_interpreter_file_names(file_names: List[str]) -> List[str]:
    normalized_file_names: List[str] = []
    seen_file_names = set()
    for file_name in file_names:
        normalized_file_name = str(file_name or "").replace(" ", "_")
        if not normalized_file_name or normalized_file_name in seen_file_names:
            continue
        normalized_file_names.append(normalized_file_name)
        seen_file_names.add(normalized_file_name)
    return normalized_file_names


def _format_documents_by_port(
    documents_by_port: Optional[Dict[str, List[str]]], max_ports: int = 6
) -> str:
    if not documents_by_port:
        return ""

    entries = []
    for port_id, file_names in list(documents_by_port.items())[:max_ports]:
        if file_names:
            entries.append(f"{port_id}: {len(file_names)} doc(s)")

    if not entries:
        return ""

    suffix = ""
    if len(documents_by_port) > max_ports:
        suffix = f" (+{len(documents_by_port) - max_ports} more ports)"
    return ", ".join(entries) + suffix


def _create_search_tools(
    tool_configs: list,
    doc_tree: list,
    brain_tree: list,
    workspace_names: list,
    top_k: int,
    collector: ToolResultCollector,
    file_names: Optional[List[str]] = None,
    documents_by_port: Optional[Dict[str, List[str]]] = None,
    user_id: Optional[str] = None,
) -> List[StructuredTool]:
    """Create document-search and brain-search LangChain tools.

    When file_names is provided (non-empty list), only the filtered search tool
    will be created, which restricts search to the specified file names.
    """
    from src.smart_rag.tools import (
        construct_json,
        generate_brain_tree_schema,
        SearchToolkit,
    )
    from src.config.settings import get_settings

    settings = get_settings()
    tools: List[StructuredTool] = []

    # When file_names is provided without doc_tree, skip schema construction
    # Filtered search works with just file names
    if doc_tree:
        doc_tree_copy = copy.deepcopy(doc_tree)
        schema, attribute_mapping, _ = construct_json(doc_tree_copy)
    elif file_names:
        # Filtered search mode - no schema needed
        schema, attribute_mapping = None, {}
    else:
        # No doc_tree and no file_names - can't create search tools
        return tools

    brain_schema, brain_attribute_mapping = None, None
    if brain_tree:
        brain_schema, brain_attribute_mapping, _ = generate_brain_tree_schema(
            brain_tree
        )

    # Build toolkit
    toolkit = SearchToolkit(
        task_order=None,
        workspace_name=workspace_names,
        top_k=top_k,
        vectorstore=getattr(settings, "QDRANT_COLLECTION_NAME", "vectorstoredev2"),
        attribute_mapping=attribute_mapping or {},
        brain_attribute_mapping=brain_attribute_mapping or {},
        search_web="off",
        user_id=user_id,
    )

    # Track how many sources we've already observed so repeated searches do not
    # reprocess the same SearchToolkit citation state.
    # Must be defined before the file_names check so both paths can use it
    prev_text_count = 0
    prev_image_count = 0

    def _collect_new_citations():
        """Drain legacy SearchToolkit citations without returning them."""
        nonlocal prev_text_count, prev_image_count

        prev_text_count = len(getattr(toolkit, "sources_text", []))
        prev_image_count = len(getattr(toolkit, "sources_image", []))


    # When file_names is provided, only create filtered search tool
    if file_names:
        logger.info(
            "CREATING_FILTERED_SEARCH_TOOL",
            file_names_count=len(file_names),
        )

        async def _filtered_search(query: str) -> str:
            result = await toolkit.perform_filtered_search(query, file_names)
            _collect_new_citations()
            return _format_search_result(result)

        tools.append(
            StructuredTool(
                name="perform_filtered_search",
                description=(
                    f"Search within specific documents from the knowledge base. "
                    f"Restricted to {len(file_names)} document(s). "
                    f"Use this to find information in the specified documents only."
                    + (
                        f" Port groups: {_format_documents_by_port(documents_by_port)}."
                        if documents_by_port
                        else ""
                    )
                ),
                func=None,
                coroutine=_filtered_search,
                args_schema=SearchQueryInput,
            )
        )
        return tools

    # Document search tool
    if attribute_mapping:

        async def _document_search(query: str) -> str:
            result = await toolkit.perform_document_search(query)
            _collect_new_citations()
            return _format_search_result(result)

        tools.append(
            StructuredTool(
                name="perform_document_search",
                description=(
                    "Search within specific documents from the knowledge base. "
                    "Use this to find information in uploaded documents."
                ),
                func=None,
                coroutine=_document_search,
                args_schema=SearchQueryInput,
            )
        )

    # Brain search tool
    if brain_attribute_mapping:

        async def _brain_search(
            query: str, brain_name: str = None, document_filter: str = None
        ) -> str:
            result = await toolkit.preform_all_brain_search(
                query, brain_name, document_filter
            )
            _collect_new_citations()
            return _format_search_result(result)

        tools.append(
            StructuredTool(
                name="preform_all_brain_search",
                description=(
                    "Search across all knowledge bases (brains). "
                    "Optionally filter by brain name or document."
                ),
                func=None,
                coroutine=_brain_search,
                args_schema=BrainSearchInput,
            )
        )

    # Standard search fallback (when no specific schema but we have workspace_names)
    if not attribute_mapping and not brain_attribute_mapping:

        async def _standard_search(query: str) -> str:
            result = await toolkit.perform_standard_search(query)
            _collect_new_citations()
            return _format_search_result(result)

        tools.append(
            StructuredTool(
                name="perform_standard_search",
                description="Search all available documents.",
                func=None,
                coroutine=_standard_search,
                args_schema=SearchQueryInput,
            )
        )

    return tools


def _create_in_memory_tools(
    tool_configs: list,
    doc_tree: list,
    workspace_names: list,
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
        workspace_name=workspace_names,
        top_k=top_k,
        vectorstore=getattr(settings, "QDRANT_COLLECTION_NAME", "vectorstoredev2"),
        search_web="off",
    )
    toolkit.set_in_memory_documents(copy.deepcopy(doc_tree))

    async def _in_memory_extraction(file_name: str) -> str:
        return await toolkit.perform_in_memory_extraction(file_name)

    return [
        StructuredTool(
            name="perform_in_memory_extraction",
            description=in_memory_desc,
            func=None,
            coroutine=_in_memory_extraction,
            args_schema=InMemoryInput,
        )
    ]


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


def _create_web_search_tool(
    workspace_names: list, collector: ToolResultCollector
) -> Optional[StructuredTool]:
    """Create a web search LangChain tool."""
    from src.smart_rag.tools import SearchToolkit

    toolkit = SearchToolkit(
        task_order=None,
        workspace_name=workspace_names or [],
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
            collector.add_component(
                "sources",
                {
                    "sources": [
                        {"title": s.get("title", ""), "url": s.get("url", "")}
                        for s in sources
                    ],
                },
            )
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
    workspace_names: list,
    code_interpreter_files: list,
    collector: ToolResultCollector,
    output_ports: Optional[List[Dict[str, Any]]] = None,
    documents_by_port: Optional[Dict[str, List[str]]] = None,
    output_workspace_id: str = "",
    workspace_context_mode: str = "resolved_inputs_only",
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
    normalized_code_interpreter_files = _build_code_interpreter_file_list(
        code_interpreter_files
    )
    port_scope_note = _format_documents_by_port(documents_by_port)

    if not backend_url:
        logger.warning("Code interpreter backend URL not configured, skipping tool")
        return None

    if not output_workspace_id:
        logger.warning(
            "Code interpreter output workspace not configured, skipping tool"
        )
        return None

    # Extract session params from agent_params if available
    agent_params = agent_config.get("agent_params") or {}
    session_id = agent_params.get("session_id")
    user_id = agent_params.get("user_id")
    file_workspace_ids = {
        str(doc.get("workspace_id", "")).strip()
        for doc in normalized_code_interpreter_files
        if str(doc.get("workspace_id", "")).strip()
    }
    selected_input_workspace_id = None
    if len(file_workspace_ids) == 1:
        selected_input_workspace_id = next(iter(file_workspace_ids))
    resolved_workspace_name = _resolve_code_interpreter_workspace_name(
        normalized_code_interpreter_files,
        user_id,
    )
    workspace_name, file_names, skipped_file_names, mixed_workspace_file_names = (
        build_code_interpreter_payload_context(
            normalized_code_interpreter_files,
            fallback_workspace_name=(
                resolved_workspace_name
                if normalized_code_interpreter_files
                else output_workspace_id
            ),
            selected_workspace_id=selected_input_workspace_id,
            owner_user_id=user_id,
        )
    )
    file_names = _normalize_code_interpreter_file_names(file_names)
    available_filenames = _format_available_filenames(
        [{"filename": filename} for filename in file_names]
    )
    if mixed_workspace_file_names:
        logger.warning(
            "Rejecting code interpreter call with mixed-workspace files",
            mixed_workspace_file_names=mixed_workspace_file_names,
            selected_input_workspace_id=selected_input_workspace_id,
        )
    if skipped_file_names:
        logger.warning(
            "Dropping code interpreter files without enough workspace context",
            skipped_file_names=skipped_file_names,
            selected_workspace_name=workspace_name,
        )

    async def _run_code(code: str, timeout_seconds: int = 60) -> str:
        timeout_seconds = min(timeout_seconds, 300)

        if mixed_workspace_file_names and not file_names:
            joined = ", ".join(mixed_workspace_file_names)
            return (
                "Error: Code interpreter cannot run with files from multiple workspaces. "
                f"Conflicting files: {joined}"
            )

        if not workspace_name:
            return (
                "Error: Code interpreter requires at least one workspace/brain context"
            )
        if not user_id:
            return "Error: Code interpreter requires a user_id in agent_params"
        if not session_id:
            return "Error: Code interpreter requires a session_id in agent_params"

        try:

            logger.info(
                "playbook_code_interpreter_v2_request",
                workspace_name=workspace_name,
                filetype=type(file_names),
                file_names=file_names,
                input_file_count=len(normalized_code_interpreter_files),
            )
            response = await asyncio.to_thread(
                requests.post,
                f"{backend_url}/tool/python_interpreter_v2",
                json={
                    "user_id": user_id,
                    "workspace_name": workspace_name,
                    "session_id": session_id,
                    "code": code,
                    "timeout_seconds": timeout_seconds,
                    "file_names": file_names,
                },
                timeout=timeout_seconds + 15,
            )
            response.raise_for_status()
            result = response.json()

            stdout = result.get("stdout", "")
            stderr = result.get("stderr", "")

            # Collect sandbox component
            collector.add_component(
                "sandbox",
                {
                    "code": code,
                    "output": stdout,
                    "error": stderr,
                    "output_available": True,
                },
            )

            # Collect artifact components for generated files
            for gf in result.get("generated_files", []):
                generated_filename = gf.get("filename", gf.get("name", ""))
                generated_object_key = str(gf.get("object_key") or "").strip()
                inferred_kind = (
                    infer_artifact_kind(generated_filename) or "document"
                )
                selected_port = _select_generated_artifact_output_port(
                    output_ports,
                    generated_filename,
                    inferred_kind,
                )
                artifact_data = {
                    "file_path": gf.get("azure_path")
                    or gf.get("file_path")
                    or generated_object_key
                    or "",
                    "filename": generated_filename,
                    "artifact_kind": str(
                        (selected_port or {}).get("artifact_kind") or inferred_kind
                    ).strip()
                    or inferred_kind,
                    "output_port_id": str(
                        (selected_port or {}).get("id") or ""
                    ).strip(),
                }
                if generated_object_key:
                    artifact_data["object_key"] = generated_object_key
                collector.add_component(
                    "artifact",
                    artifact_data,
                )

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
            details = (
                f" | backend body: {response.text[:500]}"
                if response is not None and response.text
                else ""
            )
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
            + (
                f" Bound input-port document groups: {port_scope_note}."
                if port_scope_note
                else ""
            )
            + (
                " Fallback workspace context is available."
                if workspace_context_mode == "fallback_playbook"
                else ""
            )
            + (
                f" Available workspace files: {available_filenames}."
                if available_filenames
                else ""
            )
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
                text = source.get(
                    "text",
                    source.get("content", source.get("page_content", str(source))),
                )
                filename = source.get("filename", source.get("source", ""))
                reference = str(source.get("source_reference") or "").strip()
                citation = f" | Citation: {reference}" if reference else ""
                header = (
                    f"[Source {i}: {filename}{citation}]"
                    if filename
                    else f"[Source {i}{citation}]"
                )
                parts.append(f"{header}\n{text}")
            else:
                parts.append(f"[Source {i}]\n{source}")

    if not parts:
        return "No relevant results found."

    return "\n\n---\n\n".join(parts)


# ---------------------------------------------------------------------------
# Connector MCP tool helpers
# ---------------------------------------------------------------------------


def _create_connector_mcp_tools(
    bindings: List[Dict[str, Any]],
    collector: ToolResultCollector,
    output_workspace_id: str = "",
    workspace_ids: Optional[List[str]] = None,
    file_names: Optional[List[str]] = None,
    user_id: Optional[str] = None,
    brain_ids: Optional[List[str]] = None,
    external_ids: Optional[List[str]] = None,
    session_id: str = "",
    workspace_paths: Optional[List[str]] = None,
) -> List[StructuredTool]:
    """Create LangChain tools from step-level connector bindings via MCP.

    Each binding specifies a connector, allowed actions, and optional fixed params.
    The actual MCP tool calls are deferred to async execution.
    """
    if not bindings:
        return []

    tools: List[StructuredTool] = []
    for binding in bindings:
        connector_id = binding.get("connector_id", "")
        connector_name = binding.get("connector_name") or connector_id
        connector_slug = binding.get(
            "connector_slug"
        ) or connector_name.lower().replace(" ", "-")
        transport_type = binding.get("mcp_transport_type", "streamable_http")
        server_url = binding.get("mcp_server_url", "")
        server_config = binding.get("mcp_server_config", {}) or {}
        raw_actions = binding.get("actions", [])
        fixed_params = binding.get("fixed_params", {})
        binding_auth_headers = binding.get("auth_headers") or {}
        binding_auth_env = binding.get("auth_env") or {}
        if (
            connector_id
            and output_workspace_id
            and binding_auth_headers.get("Authorization")
        ):
            tools.append(
                _create_connector_import_tool(
                    connector_id=connector_id,
                    connector_name=connector_name,
                    auth_headers=binding_auth_headers,
                    workspace_id=output_workspace_id,
                )
            )
        actions = (
            [
                {
                    "action_key": a
                    if isinstance(a, str)
                    else a.get("action_key", a.get("name", "")),
                    "label": None if isinstance(a, str) else a.get("label"),
                    "description": None if isinstance(a, str) else a.get("description"),
                    "parameter_schema": {}
                    if isinstance(a, str)
                    else (
                        a.get("parameter_schema") or {}
                        if a.get("parameter_schema")
                        else {}
                    ),
                }
                for a in raw_actions
            ]
            if raw_actions
            else []
        )
        if not actions:
            continue

        logger.info(
            "connector_binding_processing",
            connector_id=connector_id,
            connector_name=connector_name,
            transport_type=transport_type,
            server_url=server_url[:80] if server_url else "(empty)",
            action_count=len(actions),
        )

        for action in actions:
            action_key = action.get("action_key", "")
            action_label = action.get("label") or action_key
            action_description = (
                action.get("description") or f"Connector action '{action_key}'"
            )
            action_parameter_schema = action.get("parameter_schema") or {}
            slug = re.sub(r"[^a-z0-9-]", "", connector_slug)
            slug = slug[:24]
            tool_name = f"{slug}_{action_key}"
            tool_name = tool_name[:64]
            args_schema = _build_args_schema_for_connector_tool(
                tool_name,
                action_parameter_schema,
            )

            def _make_mcp_tool(
                cid: str = connector_id,
                cn: str = connector_name,
                ak: str = action_key,
                al: str = action_label,
                ad: str = action_description,
                arg_schema: Any = args_schema,
                tt: str = transport_type,
                su: str = server_url,
                sc: Dict[str, Any] = server_config,
                fp: Dict[str, Any] = fixed_params,
                tn: str = tool_name,
                ah: Dict[str, str] = dict(binding_auth_headers),
                ae: Dict[str, str] = binding_auth_env,
                _uid: Optional[str] = user_id,
                _wi: Optional[List[str]] = workspace_ids,
                _fn: Optional[List[str]] = file_names,
                sid: str = session_id,
                wsp: List[str] = list(workspace_paths or []),
            ) -> StructuredTool:
                async def _execute_mcp(*args: Any, **kwargs: Any) -> Any:
                    raw_params = kwargs.get("params")
                    if isinstance(raw_params, dict):
                        params = raw_params
                    elif args and isinstance(args[0], dict):
                        params = args[0]
                    else:
                        params = {k: v for k, v in kwargs.items() if k != "params"}
                    if not isinstance(params, dict):
                        params = {}
                    try:
                        if not su:
                            return (
                                f"Error: No MCP server configured for connector {cid}"
                            )

                        from src.flow_engine.mcp import (
                            call_mcp_tool,
                        )

                        merged_params = {**fp, **params}
                        merged_params.pop("user_id", None)

                        effective_auth_headers = dict(ah)
                        if tt == "streamable_http":
                            # Always override workspace_name / file_name with known-good
                            # values so LLM-guessed or fixed_params values can't reach the backend.
                            if _fn:
                                effective_auth_headers["file_name"] = json.dumps(_fn) if len(_fn) > 1 else _fn[0]
                                merged_params["file_name"] = _fn[0] if len(_fn) == 1 else _fn
                            else:
                                # No explicit file binding — strip any LLM-guessed file_name (e.g. "*")
                                merged_params.pop("file_name", None)
                                effective_auth_headers.pop("file_name", None)
                            if _wi:
                                effective_auth_headers["workspace_id"] = json.dumps(_wi) if len(_wi) > 1 else _wi[0]
                                merged_params["workspace_id"] = _wi[0] if len(_wi) == 1 else _wi
                                merged_params.pop("workspace_name", None)
                                effective_auth_headers.pop("workspace_name", None)
                            if sid:
                                effective_auth_headers["x-conversation-id"] = sid
                            if wsp:
                                effective_auth_headers["x-workspace-paths"] = ",".join(wsp)
                            logger.info(
                                "playbook_connector_mcp_context_headers file_name=%s workspace_id=%s",
                                effective_auth_headers.get("file_name"),
                                effective_auth_headers.get("workspace_id"),
                            )

                        logger.info(
                            "playbook_connector_tool_invocation connector_id=%s action_key=%s tool_name=%s request_payload=%s",
                            cid,
                            ak,
                            tn,
                            _log_payload(merged_params),
                        )
                        _last_mcp_actual_args.set(dict(merged_params))
                        response = await call_mcp_tool(
                            tt,
                            su,
                            sc,
                            ak,
                            merged_params,
                            auth_headers=effective_auth_headers,
                            auth_env=ae,
                        )
                        is_located_citation_tool = _is_locate_answer_citations_tool(ak)
                        logged_response = _loggable_connector_payload(ak, response)
                        logger.info(
                            "playbook_connector_tool_response connector_id=%s action_key=%s tool_name=%s response_type=%s full_response=%s",
                            cid,
                            ak,
                            tn,
                            type(response).__name__,
                            _log_payload(logged_response),
                        )
                        if isinstance(response, dict):
                            logger.info(
                                "playbook_connector_tool_normalized_response connector_id=%s action_key=%s tool_name=%s keys=%s source_count=%s citation_source_count=%s normalized_response=%s",
                                cid,
                                ak,
                                tn,
                                sorted(response.keys()) if is_located_citation_tool else [],
                                len(response.get("sources", []))
                                if is_located_citation_tool
                                and isinstance(response.get("sources"), list)
                                else 0,
                                len(response.get("citation_sources", []))
                                if is_located_citation_tool
                                and isinstance(response.get("citation_sources"), list)
                                else 0,
                                _log_payload(logged_response),
                            )
                            if response.get("ceph_path"):
                                ceph_path = response.get("ceph_path", "")
                                filename = (response.get("path") or ceph_path).rstrip("/").split("/")[-1]
                                artifact_kind = infer_artifact_kind(filename) or "document"
                                logger.info(
                                    "mcp_file_artifact_detected connector_id=%s action_key=%s filename=%s artifact_kind=%s ceph_path=%s",
                                    cid,
                                    ak,
                                    filename,
                                    artifact_kind,
                                    ceph_path,
                                )
                                collector.add_component("artifact", {
                                    "file_path": ceph_path,
                                    "filename": filename,
                                    "artifact_kind": artifact_kind,
                                    "output_port_id": "",
                                })
                                logger.info(
                                    "mcp_file_artifact_emitted connector_id=%s filename=%s total_components=%d",
                                    cid,
                                    filename,
                                    len(collector.components),
                                )
                            response = _collect_connector_response_components(
                                collector,
                                response,
                                tool_name=ak,
                            )
                        return response
                    except Exception as e:
                        logger.error("MCP tool execution failed", tool=tn, error=str(e))
                        return f"Connector action '{ak}' failed: {str(e)}"

                _execute_mcp.__name__ = tn

                return StructuredTool(
                    name=tn,
                    description=(
                        f"{ad} (connector: {cn}, action: {al}). "
                        "Use this connector action to search, browse, or inspect remote items first. "
                        "When you need those files inside the current workspace for downstream processing, call the matching import_to_workspace tool with the returned item references."
                    ),
                    func=None,
                    coroutine=_execute_mcp,
                    args_schema=arg_schema,
                )

            tools.append(_make_mcp_tool())

        logger.info(
            "connector_tools_created",
            connector_id=connector_id,
            tools_created=len(actions),
            tool_names=[t.name for t in tools[len(tools) - len(actions) :]],
            workspace_ids=workspace_ids,
            file_names=file_names,
        )

    return tools


# ---------------------------------------------------------------------------
# Platform tools (save_file_to_workspace)
# ---------------------------------------------------------------------------


class _SaveFileToWorkspaceInput(BaseModel):
    """Input schema for save_file_to_workspace tool."""

    download_url: str = Field(description="URL to download the file from")
    workspace_id: str = Field(description="Target workspace ID to save the file into")
    filename: str = Field(description="Target filename (e.g. 'report.xlsx')")
    mime_type: Optional[str] = Field(
        default=None,
        description="File MIME type. If omitted, inferred from the download response.",
    )
    auth_headers: Optional[Dict[str, str]] = Field(
        default=None,
        description="Optional authorization headers to include when downloading the file",
    )
    source_meta: Optional[Dict[str, str]] = Field(
        default=None,
        description="Optional metadata about the source (e.g. connector name, item ID)",
    )


def _create_platform_tools(
    agent_config: dict,
    collector: "ToolResultCollector",
) -> List[StructuredTool]:
    """Create platform tools (e.g. save_file_to_workspace) from agent_params.

    Reads platform_api_url and platform_api_token from agent_params to allow
    the agent to call back into the NestJS backend for operations like
    downloading an external file and saving it to a workspace.
    """
    agent_params = agent_config.get("agent_params") or {}
    platform_api_url = agent_params.get("platform_api_url", "")
    platform_api_token = agent_params.get("platform_api_token", "")
    user_id = agent_params.get("user_id", "")

    if not platform_api_url or not platform_api_token:
        return []

    tools: List[StructuredTool] = []

    def _make_save_file_tool(
        api_url: str = platform_api_url,
        api_token: str = platform_api_token,
        uid: str = user_id,
    ) -> StructuredTool:
        async def _save_file_to_workspace(
            download_url: str,
            workspace_id: str,
            filename: str,
            mime_type: Optional[str] = None,
            auth_headers: Optional[Dict[str, str]] = None,
            source_meta: Optional[Dict[str, str]] = None,
        ) -> str:
            import httpx

            endpoint = f"{api_url}/workspaces/{workspace_id}/documents/ingest-url"
            body: Dict[str, Any] = {
                "downloadUrl": download_url,
                "filename": filename,
                "userId": uid,
            }
            if mime_type:
                body["mimeType"] = mime_type
            if auth_headers:
                body["authHeaders"] = auth_headers
            if source_meta:
                body["sourceMeta"] = source_meta

            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(
                        endpoint,
                        json=body,
                        headers={
                            "X-Internal-Token": api_token,
                            "Content-Type": "application/json",
                        },
                    )
                    if resp.status_code >= 400:
                        return f"Error saving file to workspace: HTTP {resp.status_code} - {resp.text}"
                    data = resp.json()
                    doc = data.get("document", {})
                    return (
                        f"File saved to workspace successfully. "
                        f"Document ID: {doc.get('id')}, "
                        f"Filename: {doc.get('originalName')}, "
                        f"Size: {doc.get('size')} bytes"
                    )
            except Exception as e:
                logger.error("save_file_to_workspace failed", error=str(e))
                return f"Error saving file to workspace: {str(e)}"

        _save_file_to_workspace.__name__ = "save_file_to_workspace"

        return StructuredTool(
            name="save_file_to_workspace",
            description=(
                "Save an external file to a workspace by providing its download URL. "
                "Use this when you receive a download_url from an MCP tool (e.g. SharePoint, "
                "Google Drive) and need to make the file available in the workspace for "
                "further processing like code interpreter. The platform will download "
                "the file and store it in the workspace."
            ),
            func=None,
            coroutine=_save_file_to_workspace,
            args_schema=_SaveFileToWorkspaceInput,
        )

    tools.append(_make_save_file_tool())

    logger.info(
        "platform_tools_created",
        tool_count=len(tools),
        tool_names=[t.name for t in tools],
    )

    return tools


def _create_connector_import_tool(
    connector_id: str,
    connector_name: str,
    auth_headers: Dict[str, str],
    workspace_id: str,
) -> StructuredTool:
    settings = get_settings()
    backend_url = getattr(settings, "API_URL", None)

    async def _import_connector_items(
        mode: str,
        drive_id: Optional[str] = None,
        item_id: Optional[str] = None,
        path: Optional[str] = None,
        item_ref: Optional[Dict[str, Any]] = None,
        item_refs: Optional[List[Dict[str, Any]]] = None,
        recursive: bool = True,
    ) -> str:
        direct_item_ref = item_ref
        if not direct_item_ref and drive_id and (item_id or path):
            direct_item_ref = {
                "driveId": drive_id,
                **({"itemId": item_id} if item_id else {}),
                **({"path": path} if path else {}),
            }
        return import_connector_items_to_workspace_request(
            backend_url=backend_url or "",
            connector_id=connector_id,
            connector_name=connector_name,
            workspace_id=workspace_id,
            auth_headers=auth_headers,
            mode=mode,
            item_ref=direct_item_ref,
            item_refs=item_refs,
            recursive=recursive,
        )

    return StructuredTool(
        name=f"{re.sub(r'[^a-z0-9-]', '', connector_name.lower())[:24] or 'connector'}_import_to_workspace",
        description=(
            f"Import one file, multiple files, or a folder from {connector_name} into the current workspace. "
            "Use the connector search or browse tools first to discover the target driveId/itemId values, then call this import tool so downstream tools like the code interpreter can access the files from workspace. "
            "You can pass direct drive_id/item_id arguments, a direct item_ref like {driveId, itemId}, or the full item object returned by connector tools."
        ),
        func=None,
        coroutine=_import_connector_items,
        args_schema=ConnectorImportInput,
    )

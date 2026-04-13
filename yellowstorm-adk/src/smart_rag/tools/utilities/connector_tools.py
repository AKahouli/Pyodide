import inspect
import re
from typing import Any, Dict, List, Optional

from src.logger.logging import get_logger
from src.smart_rag.tools.search.tools import SearchToolADK

logger = get_logger("api.smart_rag.tools.connector_tools")


def _schema_type_to_adk_property(schema: Dict[str, Any]) -> Dict[str, Any]:
    schema_type = schema.get("type", "string")
    if isinstance(schema_type, list):
        schema_type = next((item for item in schema_type if item != "null"), "string")

    result: Dict[str, Any] = {
        "type": schema_type,
    }
    if schema.get("description"):
        result["description"] = schema["description"]
    if "enum" in schema:
        result["enum"] = schema["enum"]
    if "items" in schema and isinstance(schema["items"], dict):
        result["items"] = _schema_type_to_adk_property(schema["items"])
    return result


def _build_function_schema(
    name: str, description: str, parameter_schema: Dict[str, Any]
) -> Dict[str, Any]:
    properties = (
        parameter_schema.get("properties")
        if isinstance(parameter_schema, dict)
        else None
    )
    required = (
        parameter_schema.get("required") if isinstance(parameter_schema, dict) else None
    )

    if not isinstance(properties, dict) or not properties:
        properties = {
            "params": {
                "type": "object",
                "description": "Parameters for the connector action.",
            }
        }
        required = []

    return {
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": {
                    prop_name: _schema_type_to_adk_property(
                        prop_schema if isinstance(prop_schema, dict) else {}
                    )
                    for prop_name, prop_schema in properties.items()
                },
                "required": required or [],
                "additionalProperties": False,
            },
        }
    }


def _schema_type_to_python_annotation(schema: Dict[str, Any]) -> Any:
    schema_type = schema.get("type", "string")
    if isinstance(schema_type, list):
        schema_type = next((item for item in schema_type if item != "null"), "string")

    if schema_type == "integer":
        return Optional[int]
    if schema_type == "number":
        return Optional[float]
    if schema_type == "boolean":
        return Optional[bool]
    if schema_type == "array":
        return Optional[List[Any]]
    if schema_type == "object":
        return Optional[Dict[str, Any]]
    return Optional[str]


def _build_signature(parameter_schema: Dict[str, Any]) -> inspect.Signature:
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
        return inspect.Signature(
            [
                inspect.Parameter(
                    name="params",
                    kind=inspect.Parameter.KEYWORD_ONLY,
                    default=None,
                    annotation=Optional[Dict[str, Any]],
                )
            ]
        )

    parameters = []
    for prop_name, prop_schema in properties.items():
        prop_schema = prop_schema if isinstance(prop_schema, dict) else {}
        parameters.append(
            inspect.Parameter(
                name=prop_name,
                kind=inspect.Parameter.KEYWORD_ONLY,
                default=inspect.Parameter.empty
                if prop_name in required
                else prop_schema.get("default", None),
                annotation=_schema_type_to_python_annotation(prop_schema),
            )
        )

    return inspect.Signature(parameters)


def create_connector_tools(bindings: List[Dict[str, Any]]) -> List[Any]:
    tools: List[Any] = []

    for binding in bindings or []:
        connector_id = str(binding.get("connector_id") or "").strip()
        connector_name = str(binding.get("connector_name") or connector_id).strip()
        connector_slug = str(binding.get("connector_slug") or connector_name).strip()
        transport_type = str(binding.get("mcp_transport_type") or "").strip()
        server_url = str(binding.get("mcp_server_url") or "").strip()
        server_config = binding.get("mcp_server_config") or {}
        fixed_params = binding.get("fixed_params") or {}
        binding_auth_headers = binding.get("auth_headers") or {}
        binding_auth_env = binding.get("auth_env") or {}

        if not connector_id:
            continue

        for action in binding.get("actions") or []:
            action_key = str(action.get("action_key") or "").strip()
            if not action_key:
                continue

            slug = re.sub(r"[^a-z0-9-]", "", connector_slug.lower())[:24] or "connector"
            tool_name = f"{slug}_{action_key}".lower()[:64]
            description = str(
                action.get("description")
                or f"Connector action '{action_key}' from {connector_name}"
            ).strip()
            parameter_schema = action.get("parameter_schema") or {}
            schema = _build_function_schema(tool_name, description, parameter_schema)
            signature = _build_signature(parameter_schema)

            async def _connector_tool(
                _connector_id: str = connector_id,
                _transport_type: str = transport_type,
                _server_url: str = server_url,
                _server_config: Dict[str, Any] = server_config,
                _action_key: str = action_key,
                _fixed_params: Dict[str, Any] = fixed_params,
                _auth_headers: Dict[str, str] = binding_auth_headers,
                _auth_env: Dict[str, str] = binding_auth_env,
                **kwargs: Any,
            ) -> str:
                from src.langgraph_engine.mcp_client_factory import call_mcp_tool

                if not _server_url:
                    return (
                        f"Error: No MCP server configured for connector {_connector_id}"
                    )

                params = (
                    kwargs.get("params")
                    if isinstance(kwargs.get("params"), dict)
                    else kwargs
                )
                merged_params = {**_fixed_params, **params}
                return await call_mcp_tool(
                    _transport_type,
                    _server_url,
                    _server_config,
                    _action_key,
                    merged_params,
                    auth_headers=_auth_headers,
                    auth_env=_auth_env,
                )

            _connector_tool.__name__ = tool_name
            _connector_tool.__signature__ = signature
            _connector_tool.__annotations__ = {
                p.name: p.annotation for p in signature.parameters.values()
            }
            tools.append(SearchToolADK(_connector_tool, schema))

        logger.info(
            "conversation_connector_tools_created connector_id=%s connector_name=%s tool_count=%s",
            connector_id,
            connector_name,
            len(binding.get("actions") or []),
        )

    return tools


# ---------------------------------------------------------------------------
# Platform tools (save_file_to_workspace) for conversation flow
# ---------------------------------------------------------------------------

_SAVE_FILE_PARAMETER_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "download_url": {
            "type": "string",
            "description": "URL to download the file from",
        },
        "workspace_id": {
            "type": "string",
            "description": "Target workspace ID to save the file into",
        },
        "filename": {
            "type": "string",
            "description": "Target filename (e.g. 'report.xlsx')",
        },
        "mime_type": {
            "type": "string",
            "description": "File MIME type. If omitted, inferred from the download response.",
        },
        "auth_headers": {
            "type": "object",
            "description": "Optional authorization headers for downloading the file",
        },
        "source_meta": {
            "type": "object",
            "description": "Optional metadata about the source (e.g. connector name, item ID)",
        },
    },
    "required": ["download_url", "workspace_id", "filename"],
    "additionalProperties": False,
}


def create_platform_tools(agent_params: Dict[str, Any]) -> List[Any]:
    """Create platform tools (e.g. save_file_to_workspace) from agent_params.

    Reads platform_api_url and platform_api_token to allow the agent to call
    back into the NestJS backend for workspace file ingestion.
    """
    platform_api_url = agent_params.get("platform_api_url", "")
    platform_api_token = agent_params.get("platform_api_token", "")
    user_id = agent_params.get("user_id", "")

    if not platform_api_url or not platform_api_token:
        return []

    tools: List[Any] = []

    tool_name = "save_file_to_workspace"
    description = (
        "Save an external file to a workspace by providing its download URL. "
        "Use this when you receive a download_url from an MCP tool (e.g. SharePoint, "
        "Google Drive) and need to make the file available in the workspace for "
        "further processing like code interpreter. The platform will download "
        "the file and store it in the workspace."
    )
    schema = _build_function_schema(tool_name, description, _SAVE_FILE_PARAMETER_SCHEMA)
    signature = _build_signature(_SAVE_FILE_PARAMETER_SCHEMA)

    async def _save_file_to_workspace(
        _api_url: str = platform_api_url,
        _api_token: str = platform_api_token,
        _uid: str = user_id,
        **kwargs: Any,
    ) -> str:
        download_url = kwargs.get("download_url", "")
        workspace_id = kwargs.get("workspace_id", "")
        filename = kwargs.get("filename", "")
        mime_type = kwargs.get("mime_type")
        auth_headers = kwargs.get("auth_headers")
        source_meta = kwargs.get("source_meta")

        endpoint = f"{_api_url}/workspaces/{workspace_id}/documents/ingest-url"
        body: Dict[str, Any] = {
            "downloadUrl": download_url,
            "filename": filename,
            "userId": _uid,
        }
        if mime_type:
            body["mimeType"] = mime_type
        if auth_headers:
            body["authHeaders"] = auth_headers
        if source_meta:
            body["sourceMeta"] = source_meta

        try:
            import httpx

            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    endpoint,
                    json=body,
                    headers={
                        "X-Internal-Token": _api_token,
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
            logger.error(
                "save_file_to_workspace failed error=%s", str(e)
            )
            return f"Error saving file to workspace: {str(e)}"

    _save_file_to_workspace.__name__ = tool_name
    _save_file_to_workspace.__signature__ = signature
    _save_file_to_workspace.__annotations__ = {
        p.name: p.annotation for p in signature.parameters.values()
    }
    tools.append(SearchToolADK(_save_file_to_workspace, schema))

    logger.info(
        "conversation_platform_tools_created tool_count=%s",
        len(tools),
    )

    return tools

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


def _make_workspace_optional(
    parameter_schema: Dict[str, Any],
    has_default_workspace: bool,
) -> Dict[str, Any]:
    if not has_default_workspace or not isinstance(parameter_schema, dict):
        return parameter_schema

    properties = parameter_schema.get("properties")
    if not isinstance(properties, dict) or "workspace_id" not in properties:
        return parameter_schema

    cloned = dict(parameter_schema)
    required = list(cloned.get("required") or [])
    cloned["required"] = [name for name in required if name != "workspace_id"]
    return cloned


def _augment_workspace_bridge_schema(
    action_key: str,
    parameter_schema: Dict[str, Any],
    has_default_workspace: bool,
) -> Dict[str, Any]:
    cloned = _make_workspace_optional(parameter_schema, has_default_workspace)
    if not isinstance(cloned, dict):
        return parameter_schema

    properties = cloned.get("properties")
    if not isinstance(properties, dict):
        properties = {}
        cloned["properties"] = properties

    required = list(cloned.get("required") or [])

    if action_key == "import_connector_item_to_workspace":
        properties.setdefault(
            "driveId",
            {"type": "string", "description": "Drive ID for the source item."},
        )
        properties.setdefault(
            "itemId",
            {"type": "string", "description": "Item ID for the source file."},
        )
        properties.setdefault(
            "path",
            {
                "type": "string",
                "description": "Path to the source file when itemId is unavailable.",
            },
        )
        cloned["required"] = [
            name for name in required if name not in {"item_ref", "workspace_id"}
        ]
    elif action_key == "export_workspace_file_to_connector":
        properties.setdefault(
            "driveId",
            {"type": "string", "description": "Drive ID for the target location."},
        )
        properties.setdefault(
            "itemId",
            {"type": "string", "description": "Existing item ID for update mode."},
        )
        properties.setdefault(
            "path",
            {"type": "string", "description": "Folder path for create mode."},
        )
        properties.setdefault(
            "parentId",
            {"type": "string", "description": "Parent folder item ID for create mode."},
        )
        cloned["required"] = [
            name for name in required if name not in {"target_ref", "workspace_id"}
        ]

    return cloned


def _normalize_workspace_and_refs(
    action_key: str,
    params: Dict[str, Any],
    default_workspace_id: str,
) -> Dict[str, Any]:
    merged = dict(params)

    workspace_value = str(merged.get("workspace_id") or "").strip()
    if default_workspace_id and workspace_value in {
        "",
        "workspace",
        "default",
        "conversation",
    }:
        merged["workspace_id"] = default_workspace_id

    if action_key == "import_connector_item_to_workspace" and not merged.get(
        "item_ref"
    ):
        drive_id = merged.get("driveId") or merged.get("drive_id")
        item_id = merged.get("itemId") or merged.get("item_id")
        path = merged.get("path")
        if drive_id and (item_id or path):
            merged["item_ref"] = {
                "driveId": drive_id,
                **({"itemId": item_id} if item_id else {}),
                **({"path": path} if path else {}),
            }

    if action_key == "export_workspace_file_to_connector" and not merged.get(
        "target_ref"
    ):
        drive_id = merged.get("driveId") or merged.get("drive_id")
        item_id = merged.get("itemId") or merged.get("item_id")
        path = merged.get("path")
        parent_id = merged.get("parentId") or merged.get("parent_id")
        if drive_id and (item_id or path or parent_id):
            merged["target_ref"] = {
                "driveId": drive_id,
                **({"itemId": item_id} if item_id else {}),
                **({"path": path} if path else {}),
                **({"parentId": parent_id} if parent_id else {}),
            }

    return merged


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

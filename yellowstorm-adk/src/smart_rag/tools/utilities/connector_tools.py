import inspect
import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import jwt
import requests
from google.adk.tools.tool_context import ToolContext

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.smart_rag.tools.search.tools import SearchToolADK
from src.smart_rag.tools.utilities.code_interpreter import _STATE_KEY_BRAIN_DOCS

logger = get_logger("api.smart_rag.tools.connector_tools")
_platform_access_token: Optional[str] = None
_platform_access_token_expires_at = 0.0
_STATE_KEY_CONNECTOR_TEXT_SOURCES = "_connector_text_sources"
_STATE_KEY_CONNECTOR_IMAGE_SOURCES = "_connector_image_sources"
_STATE_KEY_CONNECTOR_SOURCE_SIGNATURES = "_connector_source_signatures"
_STATE_KEY_CONNECTOR_REFERENCE_COUNTER = "_connector_reference_counter"
_MCP_CONTENT_PARTS_KEY = "__mcp_content_parts"


@dataclass(frozen=True)
class ConnectorToolContext:
    workspace_id: Optional[str] = None
    brain_ids: Optional[List[str]] = None
    workspace_names: Optional[List[str]] = None
    brain_documents: Optional[List[Dict[str, Any]]] = None
    session_id: Optional[str] = None


def _log_payload(value: Any) -> str:
    try:
        return json.dumps(_redact_log_payload(value), ensure_ascii=False, default=str, indent=2)
    except (TypeError, ValueError):
        return str(value)


def _redact_log_payload(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: Dict[str, Any] = {}
        for key, nested in value.items():
            if key == "image_base64" and isinstance(nested, str):
                redacted[key] = f"[redacted base64 length={len(nested)}]"
            else:
                redacted[key] = _redact_log_payload(nested)
        return redacted
    if isinstance(value, list):
        return [_redact_log_payload(item) for item in value]
    if isinstance(value, str) and "image_base64" in value:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return "[redacted text containing image_base64]"
        if isinstance(parsed, (dict, list)):
            return json.dumps(
                _redact_log_payload(parsed),
                ensure_ascii=False,
                default=str,
            )
    return value


def _is_locate_answer_citations_action(action_key: str) -> bool:
    return "locate_answer_citations" in str(action_key or "")


def _keeps_citation_fields(action_key: str) -> bool:
    return _is_locate_answer_citations_action(action_key)


def _strip_legacy_citation_fields(response: Dict[str, Any]) -> Dict[str, Any]:
    stripped = dict(response)
    stripped.pop("citation_sources", None)
    stripped.pop("citations", None)
    stripped.pop("sources", None)
    return stripped


def _normalize_connector_action_description(description: str) -> str:
    return (
        description.replace("workspace names", "workspace IDs")
        .replace("Workspace name", "Workspace ID")
        .replace("workspace name", "workspace ID")
    )


def _build_connector_source_signature(source: Dict[str, Any]) -> str:
    source_type = str(source.get("type") or "text")
    if source_type == "image":
        parts = [
            source_type,
            str(source.get("source") or source.get("path") or ""),
            str(source.get("file_name") or ""),
            str(source.get("page") or ""),
            str(source.get("highlight_text") or ""),
            str(source.get("highlight_bbox") or source.get("block_bbox") or ""),
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


def _append_citation_guidance(text: str, references: List[str]) -> str:
    if not text or not references:
        return text
    refs = ", ".join(f"[{ref}]" for ref in references)
    return f"{text}\n\nUse citation {refs} when referencing facts from this connector result."


def _strip_mcp_content_parts(response: Any) -> Any:
    if not isinstance(response, dict) or _MCP_CONTENT_PARTS_KEY not in response:
        return response
    stripped = dict(response)
    stripped.pop(_MCP_CONTENT_PARTS_KEY, None)
    return stripped


def _build_image_reference_labels(response: Dict[str, Any]) -> List[str]:
    labels: List[str] = []
    images = response.get("images")
    if not isinstance(images, list):
        return labels
    for image in images:
        if not isinstance(image, dict):
            continue
        image_id = str(image.get("image_id") or image.get("id") or "").strip()
        index = str(image.get("image_content_index") or "").strip()
        label_parts = []
        if image_id:
            label_parts.append(f"image_id={image_id}")
        if index:
            label_parts.append(f"image_content_index={index}")
        labels.append(", ".join(label_parts) or "retrieved-image")
    return labels


def _buffer_mcp_images_for_model(response: Any, tool_context: Optional[ToolContext]) -> Any:
    if not tool_context or not isinstance(response, dict):
        return response
    parts = response.get(_MCP_CONTENT_PARTS_KEY)
    if not isinstance(parts, list):
        return response

    images: List[Dict[str, str]] = []
    image_log: List[Dict[str, Any]] = []
    for part in parts:
        if not isinstance(part, dict) or part.get("type") != "image":
            continue
        data = str(part.get("data") or "").strip()
        if not data:
            continue
        images.append(
            {
                "mime": str(part.get("mimeType") or "image/jpeg"),
                "data": data,
            }
        )
        image_log.append(
            {
                "mimeType": part.get("mimeType") or "image/jpeg",
                "decodedByteSize": part.get("decodedByteSize"),
                "forwardedToProvider": False,
            }
        )

    if not images:
        return _strip_mcp_content_parts(response)

    response_id = str(uuid.uuid4())
    labels = _build_image_reference_labels(response)
    tool_context.state[f"_pending_tool_images_{response_id}"] = images
    tool_context.state[f"_list_of_filenames_{response_id}"] = labels
    logger.info(
        "CONVERSATION_MCP_IMAGE_BRIDGE_BUFFERED response_id=%s total_content_parts=%s text_parts=%s image_parts=%s images=%s",
        response_id,
        len(parts),
        sum(1 for part in parts if isinstance(part, dict) and part.get("type") == "text"),
        len(images),
        image_log,
    )
    return _strip_mcp_content_parts(response)


def _register_connector_text_source(
    source: Dict[str, Any],
    tool_context: ToolContext,
) -> Dict[str, Any]:
    state = tool_context.state
    signatures = state.setdefault(_STATE_KEY_CONNECTOR_SOURCE_SIGNATURES, {})
    text_sources = state.setdefault(_STATE_KEY_CONNECTOR_TEXT_SOURCES, [])
    image_sources = state.setdefault(_STATE_KEY_CONNECTOR_IMAGE_SOURCES, [])
    signature = _build_connector_source_signature(source)

    existing_reference = signatures.get(signature)
    if existing_reference:
        source["reference"] = existing_reference
        return source

    next_ref = int(state.get(_STATE_KEY_CONNECTOR_REFERENCE_COUNTER, 0)) + 1
    state[_STATE_KEY_CONNECTOR_REFERENCE_COUNTER] = next_ref
    reference = str(next_ref)
    signatures[signature] = reference
    source["reference"] = reference

    source_type = str(source.get("type") or "text")
    if source_type == "image":
        image_sources.append(
            {
                "reference": reference,
                "object": {
                    "content": {
                        "path": str(source.get("source") or source.get("path") or ""),
                        "page": str(source.get("page") or ""),
                        "file_name": str(source.get("file_name") or ""),
                        "workspace_name": "",
                        "workspace_id": "",
                        "brain_id": "",
                        "height": str(source.get("height") or ""),
                        "width": str(source.get("width") or ""),
                        "highlight_text": str(source.get("highlight_text") or ""),
                        "highlight_bbox": source.get("highlight_bbox") or [],
                        "block_bbox": source.get("block_bbox") or [],
                    }
                },
            }
        )
    else:
        text_sources.append(
            {
                "reference": reference,
                "object": {
                    "content": {
                        "source": str(source.get("source") or ""),
                        "file_name": str(source.get("file_name") or ""),
                        "page": str(source.get("page") or ""),
                        "page_content": str(source.get("page_content") or ""),
                        "workspace_name": "",
                        "workspace_id": "",
                        "brain_id": "",
                        "_read_content_doc": bool(source.get("_read_content_doc")),
                        "_pages_cache": source.get("_pages_cache") or [],
                        "highlight_text": str(source.get("highlight_text") or ""),
                        "highlight_bbox": source.get("highlight_bbox") or [],
                        "block_bbox": source.get("block_bbox") or [],
                    }
                },
            }
        )

    return source


def _register_connector_response_sources(
    response: Any,
    tool_context: Optional[ToolContext],
    action_key: str = "",
) -> Any:
    if not tool_context or not isinstance(response, dict):
        return response
    if not _keeps_citation_fields(action_key):
        return _strip_legacy_citation_fields(response)

    citation_sources = response.get("citation_sources")
    if not isinstance(citation_sources, list) or not citation_sources:
        return response

    assigned_references: List[str] = []
    normalized_sources: List[Dict[str, Any]] = []
    for source in citation_sources:
        if not isinstance(source, dict):
            continue
        normalized = _register_connector_text_source(dict(source), tool_context)
        normalized_sources.append(normalized)
        reference = str(normalized.get("reference") or "").strip()
        if reference:
            assigned_references.append(reference)

    if normalized_sources:
        response = dict(response)
        response["citation_sources"] = normalized_sources
        text_value = response.get("text")
        if isinstance(text_value, str):
            response["text"] = _append_citation_guidance(text_value, assigned_references)
        logger.info(
            "CONVERSATION_MCP_CITATION_COLLECTION_COMPLETE assigned_references=%s text_source_total=%s image_source_total=%s citation_sources=%s",
            assigned_references,
            len(tool_context.state.get(_STATE_KEY_CONNECTOR_TEXT_SOURCES, [])),
            len(tool_context.state.get(_STATE_KEY_CONNECTOR_IMAGE_SOURCES, [])),
            _log_payload(normalized_sources),
        )

    return response


def _build_connector_import_url(backend_url: str) -> str:
    normalized = backend_url.rstrip("/")
    if normalized.endswith("/api/v1"):
        return f"{normalized}/connectors/transfer/import"
    if normalized.endswith("/api"):
        return f"{normalized}/v1/connectors/transfer/import"
    return f"{normalized}/api/v1/connectors/transfer/import"


def _get_platform_access_token() -> str:
    global _platform_access_token, _platform_access_token_expires_at

    now = time.time()
    if _platform_access_token and now < _platform_access_token_expires_at - 60:
        return _platform_access_token

    settings = get_settings()
    expire_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    jwt_secret = getattr(settings, "NESTJS_JWT_SECRET", None) or settings.SECRET_KEY
    _platform_access_token = jwt.encode(
        {
            "sub": settings.AUTH_USERNAME,
            "type": "access",
            "iss": "yellostorm",
            "aud": "yellostorm-api",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=expire_minutes),
        },
        jwt_secret,
        algorithm=settings.ALGORITHM,
    )
    _platform_access_token_expires_at = now + (expire_minutes * 60)
    return _platform_access_token


def import_connector_items_to_workspace_request(
    *,
    backend_url: str,
    connector_id: str,
    connector_name: str,
    workspace_id: str,
    auth_headers: Dict[str, str],
    mode: str,
    item_ref: Optional[Dict[str, Any]] = None,
    item_refs: Optional[List[Dict[str, Any]]] = None,
    recursive: bool = True,
) -> str:
    def _coerce_item_ref(value: Any) -> Dict[str, Any]:
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return {}
        if not isinstance(value, dict):
            return {}
        if value.get("driveId") and (value.get("itemId") or value.get("path")):
            return {
                key: value[key]
                for key in (
                    "driveId",
                    "itemId",
                    "path",
                    "siteId",
                    "webUrl",
                    "listItemUniqueId",
                    "listId",
                    "siteUrl",
                )
                if key in value and value[key]
            }
        for nested_key in ("item", "data", "result"):
            nested = value.get(nested_key)
            if isinstance(nested, dict):
                result = _coerce_item_ref(nested)
                if result:
                    return result
            if isinstance(nested, str):
                try:
                    nested = json.loads(nested)
                    if isinstance(nested, dict):
                        result = _coerce_item_ref(nested)
                        if result:
                            return result
                except (json.JSONDecodeError, TypeError):
                    pass
        for key, val in value.items():
            if (
                isinstance(val, dict)
                and val.get("driveId")
                and (val.get("itemId") or val.get("path"))
            ):
                return {
                    k: val[k]
                    for k in (
                        "driveId",
                        "itemId",
                        "path",
                        "siteId",
                        "webUrl",
                        "listItemUniqueId",
                        "listId",
                        "siteUrl",
                    )
                    if k in val and val[k]
                }
        return {}

    normalized_mode = str(mode or "").strip().lower()
    if normalized_mode not in {"file", "files", "folder"}:
        return "Error: mode must be one of 'file', 'files', or 'folder'"
    if not backend_url:
        return "Error: backend API URL is not configured"
    if not workspace_id:
        return "Error: no workspace_id is available for connector import"

    normalized_item_ref = _coerce_item_ref(item_ref)
    normalized_item_refs = [_coerce_item_ref(item) for item in (item_refs or [])]
    normalized_item_refs = [item for item in normalized_item_refs if item]

    if not normalized_item_ref and not normalized_item_refs:
        ref_preview = str(item_ref)[:200] if item_ref else "None"
        refs_preview = str(item_refs)[:200] if item_refs else "None"
        return (
            f"Error: could not extract driveId/itemId from the provided item reference. "
            f"item_ref={ref_preview}, item_refs={refs_preview}. "
            f"Expected an object with driveId and itemId fields."
        )

    payload: Dict[str, Any] = {
        "connectorId": connector_id,
        "workspaceId": workspace_id,
        "mode": normalized_mode,
        "recursive": recursive,
        "flatten": True,
    }
    if normalized_mode == "files":
        payload["itemRefs"] = normalized_item_refs
    else:
        payload["itemRef"] = normalized_item_ref

    if normalized_mode == "files" and not payload["itemRefs"]:
        return "Error: item_refs is required when mode='files'"
    if normalized_mode in {"file", "folder"} and not payload["itemRef"]:
        return f"Error: item_ref is required when mode='{normalized_mode}'"

    try:
        response = requests.post(
            _build_connector_import_url(backend_url),
            json=payload,
            headers={
                "Authorization": f"Bearer {_get_platform_access_token()}",
                "Content-Type": "application/json",
            },
            timeout=120,
        )
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        response = getattr(exc, "response", None)
        details = (
            f" | backend body: {response.text[:500]}"
            if response is not None and getattr(response, "text", None)
            else ""
        )
        return f"Error: failed to import connector items to workspace: {exc}{details}"

    result_payload = data.get("data") if isinstance(data.get("data"), dict) else data
    summary = result_payload.get("summary") or {}
    imported = result_payload.get("imported") or []
    errors = result_payload.get("errors") or []
    imported_lines = []
    for item in imported[:10]:
        if item.get("success"):
            imported_lines.append(
                f"- {item.get('finalFilename') or item.get('filename')} -> workspaceDocumentId={item.get('workspaceDocumentId')}"
            )
        else:
            imported_lines.append(
                f"- FAILED {item.get('sourcePath') or item.get('filename')}: {item.get('error')}"
            )
    error_lines = [
        f"- {err.get('sourcePath') or 'item'}: {err.get('error')}"
        for err in errors[:10]
    ]

    parts = [
        f"Imported connector items from {connector_name} into workspace {workspace_id}.",
        f"Requested: {summary.get('requested', 0)}, imported: {summary.get('imported', 0)}, failed: {summary.get('failed', 0)}.",
    ]
    if imported_lines:
        parts.append("Imported items:\n" + "\n".join(imported_lines))
    if error_lines:
        parts.append("Errors:\n" + "\n".join(error_lines))
    return "\n\n".join(parts)


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


def _with_tool_context_signature(signature: inspect.Signature) -> inspect.Signature:
    parameters = list(signature.parameters.values())
    if "tool_context" not in signature.parameters:
        parameters.append(
            inspect.Parameter(
                name="tool_context",
                kind=inspect.Parameter.KEYWORD_ONLY,
                default=None,
                annotation=ToolContext,
            )
        )
    return inspect.Signature(parameters)


_SINGULAR_WORKSPACE_NAME_PARAMS = ("workspace_name", "workspaceName")
_PLURAL_WORKSPACE_NAME_PARAMS = ("workspace_names", "workspaceNames")
_SINGULAR_LEGACY_WORKSPACE_PARAMS = (
    "brain_id",
    "brainId",
    "workspace_id",
    "workspaceId",
)
_PLURAL_LEGACY_WORKSPACE_PARAMS = (
    "brain_ids",
    "brainIds",
    "workspace_ids",
    "workspaceIds",
)
_WORKSPACE_PLACEHOLDER_VALUES = {"default"}


def _is_workspace_placeholder(value: Any) -> bool:
    return str(value or "").strip().lower() in _WORKSPACE_PLACEHOLDER_VALUES


def _needs_workspace_binding(value: Any) -> bool:
    return not str(value or "").strip() or _is_workspace_placeholder(value)


def _resolve_default_workspace_id(
    workspace_names: Optional[List[str]], workspace_id: Optional[str]
) -> Optional[str]:
    normalized_workspace_id = str(workspace_id or "").strip()
    if normalized_workspace_id:
        return normalized_workspace_id
    for value in workspace_names or []:
        normalized = str(value or "").strip()
        if normalized:
            return normalized
    return None


def _relax_bound_workspace_requirements(
    parameter_schema: Dict[str, Any],
    default_workspace_id: Optional[str],
) -> Dict[str, Any]:
    if not default_workspace_id or not isinstance(parameter_schema, dict):
        return parameter_schema

    properties = parameter_schema.get("properties")
    required = parameter_schema.get("required")
    if not isinstance(properties, dict) or not isinstance(required, list):
        return parameter_schema

    bound_names = {
        name
        for name in (
            *_SINGULAR_WORKSPACE_NAME_PARAMS,
            *_PLURAL_WORKSPACE_NAME_PARAMS,
            *_SINGULAR_LEGACY_WORKSPACE_PARAMS,
            *_PLURAL_LEGACY_WORKSPACE_PARAMS,
        )
        if name in properties
    }
    if not bound_names:
        return parameter_schema

    relaxed_schema = dict(parameter_schema)
    relaxed_schema["required"] = [name for name in required if name not in bound_names]
    return relaxed_schema

def _relax_fixed_param_requirements(
    parameter_schema: Dict[str, Any],
    fixed_params: Dict[str, Any],
) -> Dict[str, Any]:
    if not isinstance(parameter_schema, dict) or not isinstance(fixed_params, dict):
        return parameter_schema

    properties = parameter_schema.get("properties")
    required = parameter_schema.get("required")
    if not isinstance(properties, dict) or not isinstance(required, list):
        return parameter_schema

    fixed_names = {
        name
        for name, value in fixed_params.items()
        if name in properties and value not in (None, "", [], {})
    }
    if not fixed_names:
        return parameter_schema

    relaxed_schema = dict(parameter_schema)
    relaxed_schema["required"] = [name for name in required if name not in fixed_names]
    return relaxed_schema


def _with_default_workspace_params(
    params: Dict[str, Any],
    parameter_schema: Dict[str, Any],
    workspace_names: Optional[List[str]],
    workspace_id: Optional[str],
) -> Dict[str, Any]:
    default_workspace_id = _resolve_default_workspace_id(
        workspace_names, workspace_id
    )
    if not default_workspace_id:
        return params

    merged_params = dict(params)
    properties = (
        parameter_schema.get("properties")
        if isinstance(parameter_schema, dict)
        else None
    )

    # Generic connector schemas expose a free-form `params` object, so bind the
    # canonical workspace_id there. Explicit schemas only receive declared fields.
    if not isinstance(properties, dict) or not properties:
        if _needs_workspace_binding(merged_params.get("workspace_id")):
            merged_params["workspace_id"] = default_workspace_id
        return merged_params

    for name in _SINGULAR_LEGACY_WORKSPACE_PARAMS:
        if name in properties and _needs_workspace_binding(merged_params.get(name)):
            merged_params[name] = default_workspace_id

    for name in _SINGULAR_WORKSPACE_NAME_PARAMS:
        if name in properties and _needs_workspace_binding(merged_params.get(name)):
            merged_params[name] = default_workspace_id

    available_workspace_ids = [
        str(value).strip()
        for value in (workspace_names or [])
        if str(value or "").strip()
    ] or [default_workspace_id]
    for name in _PLURAL_LEGACY_WORKSPACE_PARAMS:
        if name in properties and not merged_params.get(name):
            merged_params[name] = available_workspace_ids

    for name in _PLURAL_WORKSPACE_NAME_PARAMS:
        if name in properties and not merged_params.get(name):
            merged_params[name] = available_workspace_ids

    return merged_params


def _unique_strings(values: List[Any]) -> List[str]:
    normalized: List[str] = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            normalized.append(text)
    return normalized


def _collect_connector_context(
    brain_documents: Optional[List[Dict[str, Any]]],
    workspace_names: Optional[List[str]],
    workspace_id: Optional[str],
) -> Dict[str, List[str]]:
    file_names: List[Any] = []
    workspace_ids: List[Any] = []
    workspace_paths: List[Any] = []

    for doc in brain_documents or []:
        if not isinstance(doc, dict):
            continue
        file_names.append(doc.get("file_name") or doc.get("filename"))
        workspace_ids.append(doc.get("workspace_id"))
        workspace_paths.append(doc.get("workspace_name") or doc.get("workspace_id"))

    workspace_ids.append(workspace_id)
    workspace_ids.extend(workspace_names or [])
    workspace_paths.extend(workspace_names or [])

    return {
        "file_names": _unique_strings(file_names),
        "workspace_ids": _unique_strings(workspace_ids),
        "workspace_paths": _unique_strings(workspace_paths),
    }


def _apply_streamable_http_context_headers(
    auth_headers: Dict[str, str],
    context: Dict[str, List[str]],
    session_id: Optional[str],
) -> Dict[str, str]:
    headers = dict(auth_headers)
    file_names = context.get("file_names") or []
    workspace_ids = context.get("workspace_ids") or []
    workspace_paths = context.get("workspace_paths") or []

    if len(file_names) == 1:
        headers["file_name"] = file_names[0]
    else:
        headers.pop("file_name", None)

    if workspace_ids:
        headers["workspace_id"] = json.dumps(workspace_ids) if len(workspace_ids) > 1 else workspace_ids[0]
        headers.pop("workspace_name", None)

    if session_id:
        headers["x-conversation-id"] = session_id

    if workspace_paths:
        headers["x-workspace-paths"] = ",".join(workspace_paths)

    return headers


def create_connector_tools(
    bindings: List[Dict[str, Any]],
    context: Optional[ConnectorToolContext] = None,
) -> List[Any]:
    context = context or ConnectorToolContext()
    tools: List[Any] = []
    effective_workspace_names = (
        context.workspace_names
        if context.workspace_names is not None
        else context.brain_ids
    )
    connector_context = _collect_connector_context(
        context.brain_documents,
        effective_workspace_names,
        context.workspace_id,
    )
    settings = get_settings()
    backend_url = getattr(settings, "API_URL", None)

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

        if context.workspace_id and binding_auth_headers.get("Authorization"):
            slug = re.sub(r"[^a-z0-9-]", "", connector_slug.lower())[:24] or "connector"
            tool_name = f"{slug}_import_to_workspace".lower()[:64]
            schema = {
                "function": {
                    "name": tool_name,
                    "description": (
                        f"Import one file, multiple files, or a folder from {connector_name} into the current workspace after you identify the target items with the connector search or browse tools. "
                        "Use a connector discovery tool first to get driveId/itemId references, then call this import tool before asking downstream tools like the code interpreter to process the files. "
                        "You can pass direct drive_id/item_id arguments, a direct item_ref like {driveId, itemId}, or the full item object returned by connector tools."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "mode": {
                                "type": "string",
                                "enum": ["file", "files", "folder"],
                                "description": "Import mode.",
                            },
                            "drive_id": {
                                "type": "string",
                                "description": "Optional direct drive ID for simple file or folder import calls.",
                            },
                            "item_id": {
                                "type": "string",
                                "description": "Optional direct item ID for simple file or folder import calls.",
                            },
                            "path": {
                                "type": "string",
                                "description": "Optional direct path for simple file or folder import calls when item_id is not available.",
                            },
                            "item_ref": {
                                "type": "object",
                                "description": "Single item reference for file or folder import. Accepts either {driveId, itemId} or a full MCP result object containing an item field.",
                            },
                            "item_refs": {
                                "type": "array",
                                "description": "Multiple item references for batch import. Each entry can be either {driveId, itemId} or a full MCP result object containing an item field.",
                                "items": {"type": "object"},
                            },
                            "recursive": {
                                "type": "boolean",
                                "description": "Recursively import folder contents when mode is 'folder'.",
                            },
                        },
                        "required": ["mode"],
                        "additionalProperties": False,
                    },
                }
            }
            signature = inspect.Signature(
                [
                    inspect.Parameter(
                        "mode", inspect.Parameter.KEYWORD_ONLY, annotation=Optional[str]
                    ),
                    inspect.Parameter(
                        "drive_id",
                        inspect.Parameter.KEYWORD_ONLY,
                        default=None,
                        annotation=Optional[str],
                    ),
                    inspect.Parameter(
                        "item_id",
                        inspect.Parameter.KEYWORD_ONLY,
                        default=None,
                        annotation=Optional[str],
                    ),
                    inspect.Parameter(
                        "path",
                        inspect.Parameter.KEYWORD_ONLY,
                        default=None,
                        annotation=Optional[str],
                    ),
                    inspect.Parameter(
                        "item_ref",
                        inspect.Parameter.KEYWORD_ONLY,
                        default=None,
                        annotation=Optional[Dict[str, Any]],
                    ),
                    inspect.Parameter(
                        "item_refs",
                        inspect.Parameter.KEYWORD_ONLY,
                        default=None,
                        annotation=Optional[List[Any]],
                    ),
                    inspect.Parameter(
                        "recursive",
                        inspect.Parameter.KEYWORD_ONLY,
                        default=True,
                        annotation=Optional[bool],
                    ),
                ]
            )

            async def _import_tool(
                _connector_id: str = connector_id,
                _connector_name: str = connector_name,
                _workspace_id: str = context.workspace_id,
                _auth_headers: Dict[str, str] = binding_auth_headers,
                _backend_url: Optional[str] = backend_url,
                mode: Optional[str] = None,
                drive_id: Optional[str] = None,
                item_id: Optional[str] = None,
                path: Optional[str] = None,
                item_ref: Optional[Dict[str, Any]] = None,
                item_refs: Optional[List[Any]] = None,
                recursive: bool = True,
            ) -> str:
                normalized_item_refs = [
                    item for item in (item_refs or []) if isinstance(item, dict)
                ]
                direct_item_ref = item_ref
                if not direct_item_ref and drive_id and (item_id or path):
                    direct_item_ref = {
                        "driveId": drive_id,
                        **({"itemId": item_id} if item_id else {}),
                        **({"path": path} if path else {}),
                    }
                return import_connector_items_to_workspace_request(
                    backend_url=_backend_url or "",
                    connector_id=_connector_id,
                    connector_name=_connector_name,
                    workspace_id=_workspace_id,
                    auth_headers=_auth_headers,
                    mode=mode or "",
                    item_ref=direct_item_ref,
                    item_refs=normalized_item_refs,
                    recursive=recursive,
                )

            _import_tool.__name__ = tool_name
            _import_tool.__signature__ = signature
            _import_tool.__annotations__ = {
                p.name: p.annotation for p in signature.parameters.values()
            }
            tools.append(SearchToolADK(_import_tool, schema))

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
            description = _normalize_connector_action_description(description)
            description = (
                f"{description} Use this tool to search, browse, or inspect remote items first. "
                "If the files need to be processed in the current workspace, call the matching import_to_workspace tool afterward with the returned item references."
            )
            default_workspace_id = _resolve_default_workspace_id(
                effective_workspace_names, context.workspace_id
            )
            parameter_schema = _relax_bound_workspace_requirements(
                action.get("parameter_schema") or {},
                default_workspace_id,
            )
            parameter_schema = _relax_fixed_param_requirements(
                parameter_schema,
                fixed_params,
            )
            schema = _build_function_schema(tool_name, description, parameter_schema)
            signature = _build_signature(parameter_schema)

            async def _connector_tool(
                _connector_id: str = connector_id,
                _transport_type: str = transport_type,
                _server_url: str = server_url,
                _server_config: Dict[str, Any] = server_config,
                _action_key: str = action_key,
                _fixed_params: Dict[str, Any] = fixed_params,
                _auth_headers: Dict[str, str] = dict(binding_auth_headers),
                _auth_env: Dict[str, str] = binding_auth_env,
                _parameter_schema: Dict[str, Any] = parameter_schema,
                _tool_name: str = tool_name,
                _connector_context: Dict[str, List[str]] = connector_context,
                _session_id: Optional[str] = context.session_id,
                tool_context: ToolContext = None,
                **kwargs: Any,
            ) -> Any:
                from src.flow_engine.mcp import call_mcp_tool

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
                merged_params.pop("user_id", None)
                merged_params = _with_default_workspace_params(
                    merged_params,
                    _parameter_schema,
                    effective_workspace_names,
                    context.workspace_id,
                )
                effective_auth_headers = (
                    _apply_streamable_http_context_headers(
                        _auth_headers,
                        _connector_context,
                        _session_id,
                    )
                    if _transport_type == "streamable_http"
                    else dict(_auth_headers)
                )
                response = await call_mcp_tool(
                    _transport_type,
                    _server_url,
                    _server_config,
                    _action_key,
                    merged_params,
                    auth_headers=effective_auth_headers,
                    auth_env=_auth_env,
                )
                response = _buffer_mcp_images_for_model(response, tool_context)
                registered_response = _register_connector_response_sources(
                    response,
                    tool_context,
                    action_key=_action_key,
                )
                return registered_response

            logger.info(
                "connector_tool_created tool_name=%s action_key=%s auth_header_names=%s",
                tool_name,
                action_key,
                sorted(binding_auth_headers.keys()),
            )

            _connector_tool.__name__ = tool_name
            runtime_signature = _with_tool_context_signature(signature)
            _connector_tool.__signature__ = runtime_signature
            _connector_tool.__annotations__ = {
                p.name: p.annotation for p in runtime_signature.parameters.values()
            }
            tools.append(SearchToolADK(_connector_tool, schema))

        logger.info(
            "conversation_connector_tools_created connector_id=%s connector_name=%s tool_count=%s workspace_names=%s",
            connector_id,
            connector_name,
            len(binding.get("actions") or []),
            effective_workspace_names,
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
        tool_context: ToolContext = None,
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

                # Fix 3: Propagate saved file to code interpreter brain_docs
                # so subsequent python_interpreter calls can access it in the same session.
                if tool_context and doc:
                    file_path = doc.get("filePath") or doc.get("azurePath") or ""
                    saved_filename = doc.get("originalName") or filename
                    if file_path and workspace_id:
                        try:
                            brain_docs = tool_context.state.get(_STATE_KEY_BRAIN_DOCS, [])
                            existing_paths = {d.get("filepath") for d in brain_docs}
                            if file_path not in existing_paths:
                                brain_docs.append({
                                    "filename": saved_filename,
                                    "filepath": file_path,
                                    "workspace_id": workspace_id,
                                })
                                tool_context.state[_STATE_KEY_BRAIN_DOCS] = brain_docs
                                logger.info(
                                    "save_file_to_workspace propagated file to brain_docs: "
                                    "filename=%s, workspace_id=%s",
                                    saved_filename, workspace_id,
                                )
                        except Exception as state_err:
                            logger.warning("Failed to update brain_docs state: %s", state_err)

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

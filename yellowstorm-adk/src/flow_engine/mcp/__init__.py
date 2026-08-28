"""Factory for calling MCP tools from server configuration."""

import base64
import json
import logging
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)
_MCP_CONTENT_PARTS_KEY = "__mcp_content_parts"


def _log_payload(value: Any) -> str:
    """Serialize payloads for full-fidelity logging."""
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
            elif key == "data" and value.get("type") == "image" and isinstance(nested, str):
                redacted[key] = f"[redacted image base64 length={len(nested)}]"
            else:
                redacted[key] = _redact_log_payload(nested)
        return redacted
    if isinstance(value, list):
        return [_redact_log_payload(item) for item in value]
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


def _display_source_name(value: Any) -> str:
    """Normalize a source field to a human-readable filename when possible."""
    text = str(value or "").strip()
    if not text:
        return ""

    parsed = urlparse(text)
    if parsed.scheme and parsed.netloc:
        path = parsed.path.rstrip("/")
        if path:
            candidate = path.rsplit("/", 1)[-1].strip()
            if candidate:
                return candidate

    normalized = text.rstrip("/")
    if "/" in normalized:
        candidate = normalized.rsplit("/", 1)[-1].strip()
        if candidate:
            return candidate

    return text


def _coerce_json(value: Any) -> Any:
    """Best-effort JSON parsing for MCP text payloads."""
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return value


def _part_field(part: Any, *names: str) -> Any:
    for name in names:
        if isinstance(part, dict) and name in part:
            return part.get(name)
        if hasattr(part, name):
            return getattr(part, name)
    return None


def _decoded_image_size(image_data: str) -> int:
    value = str(image_data or "").strip()
    if "," in value and value.startswith("data:"):
        value = value.split(",", 1)[1]
    try:
        return len(base64.b64decode(value, validate=False))
    except Exception:
        return 0


def _serialize_mcp_content_parts(content_parts: List[Any]) -> List[Dict[str, Any]]:
    serialized: List[Dict[str, Any]] = []
    for part in content_parts:
        part_type = str(_part_field(part, "type") or "").lower()
        text = _part_field(part, "text")
        image_data = _part_field(part, "data")
        mime_type = str(
            _part_field(part, "mimeType", "mime_type", "mime")
            or "image/jpeg"
        )

        if part_type == "image" and isinstance(image_data, str) and image_data:
            serialized.append(
                {
                    "type": "image",
                    "data": image_data,
                    "mimeType": mime_type,
                    "decodedByteSize": _decoded_image_size(image_data),
                }
            )
        elif isinstance(text, str):
            serialized.append({"type": "text", "text": text})
    return serialized


def _attach_mcp_content_parts(response: Any, parts: List[Dict[str, Any]]) -> Any:
    if not any(part.get("type") == "image" for part in parts):
        return response
    if isinstance(response, dict):
        response = dict(response)
        response[_MCP_CONTENT_PARTS_KEY] = parts
        return response
    return {"text": str(response), _MCP_CONTENT_PARTS_KEY: parts}


def _log_mcp_image_bridge(action_key: str, parts: List[Dict[str, Any]]) -> None:
    image_parts = [part for part in parts if part.get("type") == "image"]
    if not image_parts:
        return
    text_count = sum(1 for part in parts if part.get("type") == "text")
    logger.info(
        "mcp_image_bridge_received action=%s total_content_parts=%s text_parts=%s image_parts=%s images=%s",
        action_key,
        len(parts),
        text_count,
        len(image_parts),
        [
            {
                "mimeType": image.get("mimeType"),
                "decodedByteSize": image.get("decodedByteSize"),
                "forwardedToProvider": False,
            }
            for image in image_parts
        ],
    )


def _normalize_source_list(payload: Any) -> List[Dict[str, str]]:
    """Extract web-style source links from a structured MCP payload."""
    if not isinstance(payload, list):
        return []

    normalized: List[Dict[str, str]] = []
    seen = set()

    for item in payload:
        if not isinstance(item, dict):
            continue
        url = str(
            item.get("url")
            or item.get("webUrl")
            or item.get("downloadUrl")
            or ""
        ).strip()
        if not url:
            continue
        title = str(
            item.get("title")
            or item.get("name")
            or item.get("filename")
            or item.get("displayName")
            or url
        ).strip()
        signature = (title, url)
        if signature in seen:
            continue
        seen.add(signature)
        normalized.append({"title": title, "url": url})

    return normalized


def _normalize_search_result_blocks(
    payload: Any,
    source_label: str,
) -> List[Dict[str, str]]:
    """Convert search-style block results into citation source entries."""
    blocks = payload
    if isinstance(blocks, str):
        blocks = _coerce_json(blocks)
    if not isinstance(blocks, list):
        return []

    citation_sources: List[Dict[str, str]] = []
    seen = set()
    for block in blocks:
        if not isinstance(block, dict):
            continue
        content = str(block.get("content") or "").strip()
        if not content:
            continue
        file_name = str(
            block.get("file_name")
            or block.get("external_id")
            or block.get("doc_id")
            or block.get("block_id")
            or block.get("id")
            or ""
        ).strip()
        page_number = block.get("page_number")
        page = str(page_number + 1) if isinstance(page_number, int) else str(page_number or "").strip()
        workspace_id = str(block.get("workspace_id") or block.get("brain_id") or "").strip()
        workspace_name = str(block.get("workspace_name") or workspace_id).strip()
        source = str(
            _display_source_name(
                block.get("source")
                or block.get("document_name")
                or block.get("filename")
                or block.get("file_name")
                or source_label
            )
        ).strip()
        signature = (source, file_name, page, content)
        if signature in seen:
            continue
        seen.add(signature)
        citation_sources.append(
            {
                "type": "text",
                "source": source,
                "file_name": file_name,
                "page": page,
                "page_content": content,
                "workspace_id": workspace_id,
                "workspace_name": workspace_name,
                "reference": "",
            }
        )

    return citation_sources


def _normalize_blocks_list(
    blocks: Any,
    source_label: str,
    file_name: str = "",
    workspace_id: str = "",
) -> List[Dict[str, str]]:
    """Convert a blocks array from MCP into text citation source entries."""
    if not isinstance(blocks, list):
        return []

    citation_sources: List[Dict[str, str]] = []
    seen = set()
    for block in blocks:
        if not isinstance(block, dict):
            continue
        content = str(block.get("content") or "").strip()
        if not content:
            continue
        if block.get("block_type") in ("image", "figure", "chart"):
            continue
        page_number = block.get("page_number")
        page = str(page_number) if isinstance(page_number, int) else str(page_number or "").strip()
        block_file_name = str(block.get("file_name") or block.get("external_id") or file_name).strip()
        block_workspace_id = str(block.get("workspace_id") or block.get("brain_id") or workspace_id).strip()
        block_workspace_name = str(block.get("workspace_name") or block_workspace_id).strip()
        source = str(_display_source_name(block.get("source") or source_label)).strip()

        signature = (source, block_file_name, page, content)
        if signature in seen:
            continue
        seen.add(signature)
        citation_sources.append(
            {
                "type": "text",
                "source": source,
                "file_name": block_file_name,
                "page": page,
                "page_content": content,
                "workspace_id": block_workspace_id,
                "workspace_name": block_workspace_name,
                "reference": "",
            }
        )

    return citation_sources


def _normalize_image_list(
    images: Any,
    source_label: str,
    file_name: str = "",
    workspace_id: str = "",
) -> List[Dict[str, str]]:
    """Convert an images array from MCP into image citation source entries."""
    if not isinstance(images, list):
        return []

    citation_sources: List[Dict[str, str]] = []
    seen = set()
    for img in images:
        if not isinstance(img, dict):
            continue
        path = str(img.get("path") or img.get("data") or img.get("url") or "").strip()
        if not path:
            continue
        page_number = img.get("page_number") or img.get("page")
        page = str(page_number) if isinstance(page_number, int) else str(page_number or "").strip()
        source_file_name = str(img.get("file_name") or img.get("filename") or source_label).strip()
        img_file_name = str(img.get("file_name") or img.get("external_id") or file_name).strip()
        img_workspace_id = str(img.get("workspace_id") or img.get("brain_id") or workspace_id).strip()
        img_workspace_name = str(img.get("workspace_name") or img_file_name).strip()

        signature = (path, img_file_name, page)
        if signature in seen:
            continue
        seen.add(signature)
        citation_sources.append(
            {
                "type": "image",
                "path": path,
                "page": page,
                "file_name": source_file_name,
                "workspace_name": img_workspace_name,
                "workspace_id": img_workspace_id,
                "height": str(img.get("height") or "").strip(),
                "width": str(img.get("width") or "").strip(),
                "reference": "",
            }
        )

    return citation_sources


def _normalize_mcp_response(
    parsed_payload: Any,
    fallback_text: str,
    action_key: str = "",
) -> Any:
    """Attach optional source metadata to MCP responses when present."""
    if isinstance(parsed_payload, list):
        response = {
            "text": fallback_text,
            "result": parsed_payload,
        }
        if _is_locate_answer_citations_action(action_key):
            block_citation_sources = _normalize_search_result_blocks(
                parsed_payload,
                source_label=action_key or "Connector Search Result",
            )
            if block_citation_sources:
                response["citation_sources"] = block_citation_sources

        returned_response = (
            response
            if _keeps_citation_fields(action_key)
            else _strip_legacy_citation_fields(response)
        )
        return returned_response

    if not isinstance(parsed_payload, dict):
        return fallback_text

    response = dict(parsed_payload)
    text_value = response.get("text")
    if not isinstance(text_value, str):
        text_value = fallback_text
    response["text"] = text_value

    normalized_sources: List[Dict[str, str]] = []
    if isinstance(response.get("sources"), list):
        normalized_sources.extend(_normalize_source_list(response.get("sources")))

    item = response.get("item")
    if isinstance(item, dict):
        item_sources = _normalize_source_list([item])
        for source in item_sources:
            if source not in normalized_sources:
                normalized_sources.append(source)

        content_mode = str(response.get("contentMode") or "").strip().lower()
        inline_text = response.get("text")
        if (
            _is_locate_answer_citations_action(action_key)
            and content_mode == "inline_text"
            and isinstance(inline_text, str)
            and inline_text.strip()
        ):
            item_workspace_id = str(
                item.get("workspace_id")
                or item.get("brain_id")
                or response.get("workspace_id")
                or response.get("brain_id")
                or ""
            ).strip()
            response["citation_sources"] = [
                {
                    "type": "text",
                    "source": str(
                        item.get("name")
                        or item.get("filename")
                        or item.get("displayName")
                        or "Connector Document"
                    ),
                    "file_name": str(item.get("itemId") or item.get("id") or ""),
                    "page": "",
                    "page_content": inline_text,
                    "workspace_id": item_workspace_id,
                    "workspace_name": str(
                        item.get("workspace_name")
                        or response.get("workspace_name")
                        or item_workspace_id
                    ).strip(),
                    "reference": "",
                }
            ]

    if (
        _is_locate_answer_citations_action(action_key)
        and "citation_sources" not in response
        and "result" in response
    ):
        block_citation_sources = _normalize_search_result_blocks(
            response.get("result"),
            source_label=action_key or "Connector Search Result",
        )
        if block_citation_sources:
            response["citation_sources"] = block_citation_sources

    if (
        _is_locate_answer_citations_action(action_key)
        and "citation_sources" not in response
        and isinstance(response.get("blocks"), list)
    ):
        blocks_citation_sources = _normalize_blocks_list(
            response.get("blocks"),
            source_label=str(response.get("source") or action_key or ""),
            file_name=str(response.get("file_name") or response.get("external_id") or ""),
            workspace_id=str(response.get("workspace_id") or response.get("brain_id") or ""),
        )
        if blocks_citation_sources:
            response["citation_sources"] = blocks_citation_sources

    if _is_locate_answer_citations_action(action_key) and isinstance(
        response.get("images"), list
    ):
        image_citation_sources = _normalize_image_list(
            response.get("images"),
            source_label=str(response.get("source") or action_key or ""),
            file_name=str(response.get("file_name") or response.get("external_id") or ""),
            workspace_id=str(response.get("workspace_id") or response.get("brain_id") or ""),
        )
        if image_citation_sources:
            existing = response.get("citation_sources")
            if isinstance(existing, list):
                response["citation_sources"] = existing + image_citation_sources
            else:
                response["citation_sources"] = image_citation_sources

    if normalized_sources:
        response["sources"] = normalized_sources

    returned_response = (
        response
        if _keeps_citation_fields(action_key)
        else _strip_legacy_citation_fields(response)
    )

    return returned_response


async def call_mcp_tool(
    transport_type: str,
    server_url: str,
    server_config: Optional[Dict[str, Any]],
    action_key: str,
    params: Dict[str, Any],
    auth_headers: Optional[Dict[str, str]] = None,
    auth_env: Optional[Dict[str, str]] = None,
    log_payload: bool = True,
) -> Any:
    """Call an MCP tool and return either text or a structured response.

    Creates a one-shot connection, calls the tool, and closes.

    Args:
        transport_type: 'streamable_http', 'sse', or 'stdio'.
        server_url: URL or command.
        server_config: Extra config (args, env, headers, etc.).
        action_key: The tool name to call.
        params: Parameters to pass to the tool.
        auth_headers: HTTP headers to inject (for sse/streamable_http).
        auth_env: Environment variables to inject (for stdio).

    Returns:
        Text result, structured dict result, or an error string.
    """
    merged_headers = _build_headers(server_config, auth_headers, action_key=action_key)
    merged_env = _build_env(server_config, auth_env)

    logger.info(
        "mcp_call_tool action=%s transport=%s header_names=%s request_payload=%s",
        action_key,
        transport_type,
        sorted((merged_headers or {}).keys()),
        _log_payload(params) if log_payload else "[suppressed]",
    )

    try:
        if transport_type == "stdio":
            from mcp.client.stdio import stdio_client, StdioServerParameters

            args = (server_config or {}).get("commandArgs", [])
            if isinstance(args, str):
                args = [args]

            server_params = StdioServerParameters(
                command=server_url,
                args=args,
                env=merged_env,
            )

            async with stdio_client(server_params) as streams:
                read_stream, write_stream = streams
                from mcp import ClientSession

                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(action_key, arguments=params)

        elif transport_type == "sse":
            from mcp.client.sse import sse_client

            async with sse_client(url=server_url, headers=merged_headers) as streams:
                read_stream, write_stream = streams
                from mcp import ClientSession

                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(action_key, arguments=params)

        elif transport_type == "streamable_http":
            from mcp.client.streamable_http import streamable_http_client
            import httpx

            client_headers = merged_headers or {}
            async def _inject_mcp_headers(request: httpx.Request) -> None:
                for key, value in client_headers.items():
                    request.headers[key] = value

            async with httpx.AsyncClient(
                headers=client_headers,
                event_hooks={"request": [_inject_mcp_headers]},
                follow_redirects=True,
                # read=None: no timeout on SSE stream reads (tool calls can take >5s)
                timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0),
            ) as http_client:
                async with streamable_http_client(
                    url=server_url, http_client=http_client
                ) as streams:
                    read_stream, write_stream, _ = streams
                    from mcp import ClientSession

                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        result = await session.call_tool(action_key, arguments=params)

        else:
            raise ValueError(
                f"Unsupported MCP transport type: {transport_type}. "
                "Expected 'streamable_http', 'sse', or 'stdio'."
            )

        if hasattr(result, "isError") and result.isError:
            content_parts = getattr(result, "content", []) or []
            error_texts = [p.text for p in content_parts if hasattr(p, "text")]
            error_response = (
                f"Connector action '{action_key}' failed"
                if not log_payload
                else (
                    f"Connector action '{action_key}' failed: "
                    f"{'; '.join(error_texts) or 'Unknown error'}"
                )
            )
            if log_payload:
                logger.error("mcp_tool_error action=%s error_text=%s", action_key, "; ".join(error_texts) or "Unknown error")
            else:
                logger.error("mcp_tool_error action=%s error_text=[suppressed]", action_key)
            logger.info(
                "mcp_call_tool_response action=%s transport=%s response_payload=%s",
                action_key,
                transport_type,
                _log_payload(error_response) if log_payload else "[suppressed]",
            )
            return error_response

        content_parts = getattr(result, "content", []) or []
        serialized_parts = _serialize_mcp_content_parts(content_parts)
        _log_mcp_image_bridge(action_key, serialized_parts)
        texts = []
        parsed_payload = None
        for part in content_parts:
            if str(_part_field(part, "type") or "").lower() == "image":
                continue
            if hasattr(part, "text"):
                text_value = part.text
                texts.append(text_value)
                if parsed_payload is None:
                    coerced = _coerce_json(text_value)
                    if isinstance(coerced, (dict, list)):
                        parsed_payload = coerced
            elif isinstance(part, dict):
                part_text = part.get("text", str(part))
                texts.append(part_text)
                if parsed_payload is None and isinstance(part.get("json"), (dict, list)):
                    parsed_payload = part["json"]
            else:
                texts.append(str(part))
        response_text = "\n".join(texts) if texts else str(result)
        normalized_response = _normalize_mcp_response(
            parsed_payload, response_text, action_key=action_key
        )
        normalized_response = _attach_mcp_content_parts(
            normalized_response,
            serialized_parts,
        )
        logger.info(
            "mcp_call_tool_response action=%s transport=%s response_payload=%s",
            action_key,
            transport_type,
            _log_payload(normalized_response) if log_payload else "[suppressed]",
        )
        return normalized_response
    except Exception as e:
        error_response = (
            f"Connector action '{action_key}' failed: {str(e)}"
            if log_payload
            else f"Connector action '{action_key}' failed"
        )
        if log_payload:
            logger.error("MCP tool call failed: action=%s error_type=%s error=%s", action_key, type(e).__name__, str(e))
        else:
            logger.error("MCP tool call failed: action=%s error_type=%s error=[suppressed]", action_key, type(e).__name__)
        # Unwrap ExceptionGroup / TaskGroup sub-exceptions for visibility
        # BaseExceptionGroup is only a builtin on Python 3.11+; use backport on 3.10
        try:
            _BEG = BaseExceptionGroup  # type: ignore[name-defined]
        except NameError:
            try:
                from exceptiongroup import BaseExceptionGroup as _BEG  # type: ignore[no-redef]
            except ImportError:
                _BEG = None  # type: ignore[assignment]
        if _BEG is not None and isinstance(e, _BEG):
            for sub in e.exceptions:  # type: ignore[attr-defined]
                logger.error(
                    "MCP sub-exception: action=%s type=%s error=%s",
                    action_key,
                    type(sub).__name__,
                    str(sub) if log_payload else "[suppressed]",
                )
                if isinstance(sub, _BEG):
                    for nested in sub.exceptions:  # type: ignore[attr-defined]
                        logger.error(
                            "MCP nested-exception: action=%s type=%s error=%s",
                            action_key,
                            type(nested).__name__,
                            str(nested) if log_payload else "[suppressed]",
                        )
        logger.info(
            "mcp_call_tool_response action=%s transport=%s response_payload=%s",
            action_key,
            transport_type,
            _log_payload(error_response) if log_payload else "[suppressed]",
        )
        return error_response


def _build_headers(
    server_config: Optional[Dict[str, Any]],
    auth_headers: Optional[Dict[str, str]],
    *,
    action_key: str = "",
) -> Optional[Dict[str, str]]:
    """Merge the connector's own static server config headers with resolved
    per-user auth headers.

    config_headers wins on a name collision. Some connectors (linkup,
    code-interpreter) put a static MCP-gateway secret in
    server_config["headers"]["Authorization"] — that's what gets the request
    *accepted by the gateway at all*, independent of any specific user. If
    that same connector also resolves a per-user credential under the same
    header name (e.g. a saved API credential), letting auth_headers win
    silently replaces the gateway secret with a value the gateway was never
    issued -> 401, with no error at binding time to point at why.
    """
    config_headers = (server_config or {}).get("headers", {})
    if not config_headers and not auth_headers:
        return None
    colliding = sorted(set(config_headers or {}) & set(auth_headers or {}))
    if colliding:
        # Not necessarily wrong — but a resolved per-user header is about to be
        # discarded in favor of the connector's static config for these names,
        # and that's easy to miss until a call starts failing for no visible
        # reason. Surface it once, here, rather than let someone rediscover it
        # from a 401 the way this one was found.
        logger.warning(
            "mcp_header_collision action=%s colliding_headers=%s "
            "(server_config wins; the resolved auth header for these names is discarded)",
            action_key, colliding,
        )
    merged = {}
    if auth_headers:
        merged.update(auth_headers)
    if config_headers:
        merged.update(config_headers)
    return merged


def _build_env(
    server_config: Optional[Dict[str, Any]],
    auth_env: Optional[Dict[str, str]],
) -> Optional[Dict[str, str]]:
    config_env = (server_config or {}).get("env", {})
    if not config_env and not auth_env:
        return None
    merged = {}
    if config_env:
        merged.update(config_env)
    if auth_env:
        merged.update(auth_env)
    return merged

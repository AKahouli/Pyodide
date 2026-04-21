"""Factory for calling MCP tools from server configuration."""

import json
import logging
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _log_payload(value: Any) -> str:
    """Serialize payloads for full-fidelity logging."""
    try:
        return json.dumps(value, ensure_ascii=False, default=str, indent=2)
    except (TypeError, ValueError):
        return str(value)


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
        external_id = str(
            block.get("external_id")
            or block.get("doc_id")
            or block.get("block_id")
            or block.get("id")
            or ""
        ).strip()
        page_number = block.get("page_number")
        if isinstance(page_number, int):
            page = str(page_number + 1)
        else:
            page = str(page_number or "").strip()
        workspace_id = str(block.get("brain_id") or block.get("workspace_id") or "").strip()
        source = str(
            _display_source_name(
                block.get("source")
                or block.get("document_name")
                or block.get("filename")
                or block.get("file_name")
                or source_label
            )
        ).strip()
        signature = (source, external_id, page, content)
        if signature in seen:
            continue
        seen.add(signature)
        citation_sources.append(
            {
                "type": "text",
                "source": source,
                "external_id": external_id,
                "page": page,
                "page_content": content,
                "workspace_id": workspace_id,
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
        if content_mode == "inline_text" and isinstance(inline_text, str) and inline_text.strip():
            response["citation_sources"] = [
                {
                    "type": "text",
                    "source": str(
                        item.get("name")
                        or item.get("filename")
                        or item.get("displayName")
                        or "Connector Document"
                    ),
                    "external_id": str(item.get("itemId") or item.get("id") or ""),
                    "page": "",
                    "page_content": inline_text,
                    "workspace_id": "",
                    "reference": "",
                }
            ]

    if "citation_sources" not in response and "result" in response:
        block_citation_sources = _normalize_search_result_blocks(
            response.get("result"),
            source_label=action_key or "Connector Search Result",
        )
        if block_citation_sources:
            response["citation_sources"] = block_citation_sources

    if normalized_sources:
        response["sources"] = normalized_sources

    logger.info(
        "mcp_tool_normalized_response keys=%s source_count=%s citation_source_count=%s text_length=%s",
        sorted(response.keys()),
        len(response.get("sources", []))
        if isinstance(response.get("sources"), list)
        else 0,
        len(response.get("citation_sources", []))
        if isinstance(response.get("citation_sources"), list)
        else 0,
        len(response.get("text", "")) if isinstance(response.get("text"), str) else 0,
    )

    return response


async def call_mcp_tool(
    transport_type: str,
    server_url: str,
    server_config: Optional[Dict[str, Any]],
    action_key: str,
    params: Dict[str, Any],
    auth_headers: Optional[Dict[str, str]] = None,
    auth_env: Optional[Dict[str, str]] = None,
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
    merged_headers = _build_headers(server_config, auth_headers)
    merged_env = _build_env(server_config, auth_env)

    logger.info(
        "mcp_call_tool action=%s transport=%s headers=%s request_payload=%s",
        action_key,
        transport_type,
        merged_headers,
        _log_payload(params),
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

            if merged_headers:
                http_client = httpx.AsyncClient(headers=merged_headers)
                async with streamable_http_client(
                    url=server_url, http_client=http_client
                ) as streams:
                    read_stream, write_stream, _ = streams
                    from mcp import ClientSession

                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        result = await session.call_tool(action_key, arguments=params)
            else:
                async with streamable_http_client(url=server_url) as streams:
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
            logger.error("mcp_tool_error action=%s error_text=%s", action_key, "; ".join(error_texts) or "Unknown error")
            return f"Connector action '{action_key}' failed: {'; '.join(error_texts) or 'Unknown error'}"

        content_parts = getattr(result, "content", []) or []
        texts = []
        parsed_payload = None
        for part in content_parts:
            if hasattr(part, "text"):
                text_value = part.text
                texts.append(text_value)
                if parsed_payload is None:
                    coerced = _coerce_json(text_value)
                    if isinstance(coerced, dict):
                        parsed_payload = coerced
            elif isinstance(part, dict):
                part_text = part.get("text", str(part))
                texts.append(part_text)
                if parsed_payload is None and isinstance(part.get("json"), dict):
                    parsed_payload = part["json"]
            else:
                texts.append(str(part))
        response_text = "\n".join(texts) if texts else str(result)
        logger.info(
            "mcp_tool_response action=%s response_length=%s full_response=%s",
            action_key,
            len(response_text),
            response_text,
        )
        if parsed_payload is not None:
            logger.info(
                "mcp_tool_structured_payload_detected action=%s payload_type=%s payload=%s",
                action_key,
                type(parsed_payload).__name__,
                _log_payload(parsed_payload),
            )
        else:
            logger.info(
                "mcp_tool_no_structured_payload action=%s content_part_count=%s",
                action_key,
                len(content_parts),
            )
        normalized_response = _normalize_mcp_response(
            parsed_payload, response_text, action_key=action_key
        )
        if isinstance(normalized_response, dict):
            logger.info(
                "mcp_tool_normalized_summary action=%s source_count=%s citation_source_count=%s normalized_response=%s",
                action_key,
                len(normalized_response.get("sources", []))
                if isinstance(normalized_response.get("sources"), list)
                else 0,
                len(normalized_response.get("citation_sources", []))
                if isinstance(normalized_response.get("citation_sources"), list)
                else 0,
                _log_payload(normalized_response),
            )
        return normalized_response
    except Exception as e:
        logger.error("MCP tool call failed: action=%s error=%s", action_key, str(e))
        # Unwrap ExceptionGroup / TaskGroup sub-exceptions for visibility
        if isinstance(e, BaseExceptionGroup):
            for sub in e.exceptions:
                logger.error("MCP sub-exception: action=%s type=%s error=%s", action_key, type(sub).__name__, str(sub))
                if isinstance(sub, BaseExceptionGroup):
                    for nested in sub.exceptions:
                        logger.error("MCP nested-exception: action=%s type=%s error=%s", action_key, type(nested).__name__, str(nested))
        return f"Connector action '{action_key}' failed: {str(e)}"


def _build_headers(
    server_config: Optional[Dict[str, Any]],
    auth_headers: Optional[Dict[str, str]],
) -> Optional[Dict[str, str]]:
    config_headers = (server_config or {}).get("headers", {})
    if not config_headers and not auth_headers:
        return None
    merged = {}
    if config_headers:
        merged.update(config_headers)
    if auth_headers:
        merged.update(auth_headers)
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

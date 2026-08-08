import json
from typing import Any

from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.types import Command


MCP_CONTENT_PARTS_KEY = "__mcp_content_parts"
MAX_IMAGES_PER_LLM_REQUEST = 50


def parse_tool_result(result: Any) -> Any:
    if isinstance(result, str):
        try:
            return json.loads(result)
        except (json.JSONDecodeError, ValueError):
            return result
    return result


def tool_text_content(result: Any) -> str:
    parsed = parse_tool_result(result)
    if isinstance(parsed, dict):
        parsed = {key: value for key, value in parsed.items() if key != MCP_CONTENT_PARTS_KEY}
        if isinstance(parsed.get("blocks"), list) and isinstance(parsed.get("content"), str):
            parsed.pop("blocks", None)
    return parsed if isinstance(parsed, str) else json.dumps(parsed, default=str)


def with_mcp_vision(tool_message: ToolMessage, raw_result: Any) -> ToolMessage | Command:
    parsed = parse_tool_result(raw_result)
    parts = parsed.get(MCP_CONTENT_PARTS_KEY) if isinstance(parsed, dict) else None
    tool_message.content = tool_text_content(raw_result)
    if not isinstance(parts, list):
        return tool_message
    blocks: list[dict[str, Any]] = [{"type": "text", "text": str(tool_message.content)}]
    for part in parts:
        if len(blocks) > MAX_IMAGES_PER_LLM_REQUEST or not isinstance(part, dict) or part.get("type") != "image" or not part.get("data"):
            continue
        mime_type = str(part.get("mimeType") or "image/jpeg")
        data = str(part.get("data") or "")
        url = data if data.startswith("data:image/") else f"data:{mime_type};base64,{data}"
        blocks.append({"type": "image_url", "image_url": {"url": url}})
    if len(blocks) == 1:
        return tool_message
    return Command(update={"messages": [tool_message, HumanMessage(content=blocks)]})

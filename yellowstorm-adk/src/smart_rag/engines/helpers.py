import base64
import json
from collections.abc import Mapping
from typing import Any, Dict

from google.genai import types

from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.engines.helpers")


def coerce_to_plain(value: Any) -> Any:
    """Recursively convert proto / Mapping / iterable values to plain Python types."""
    if isinstance(value, Mapping):
        return {k: coerce_to_plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [coerce_to_plain(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    try:
        return [coerce_to_plain(v) for v in iter(value)]
    except TypeError:
        return value


def coerce_to_dict(value: Any) -> Dict[str, Any]:
    """Recursively coerce proto Struct / MapComposite / Mapping / JSON string values to plain Python dicts.

    google-genai exposes function_call.args and function_response.response as dict-like
    wrappers around google.protobuf.Struct. A strict isinstance(value, dict) check misses
    these, and json.dumps on nested proto types raises. Some LLM providers via litellm
    return tool responses as JSON strings; those are parsed here too.
    """
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return {}
        return coerce_to_dict(parsed)
    if isinstance(value, dict):
        return {k: coerce_to_plain(v) for k, v in value.items()}
    if isinstance(value, Mapping):
        return {k: coerce_to_plain(v) for k, v in value.items()}
    try:
        return {k: coerce_to_plain(v) for k, v in dict(value).items()}
    except (TypeError, ValueError):
        return {}


def decode_data_uri_to_part(base64_data: str) -> types.Part:
    """Decode a base64 data URI string into a types.Part image object.

    Args:
        base64_data: Either "data:image/jpeg;base64,<data>" or raw base64 string.

    Returns:
        types.Part with decoded image bytes.

    Raises:
        Exception: If decoding fails.
    """
    if base64_data.startswith('data:'):
        mime_part, data_part = base64_data.split(',', 1)
        mime_type = mime_part.split(':')[1].split(';')[0]
        raw_data = base64.b64decode(data_part)
    else:
        mime_type = "image/jpeg"
        raw_data = base64.b64decode(base64_data)
    return types.Part.from_bytes(data=raw_data, mime_type=mime_type)


def build_content_with_images(message: str, image_input: list) -> types.Content:
    """Build multimodal content with text and images appended after.

    Args:
        message: The text message.
        image_input: List of image dicts like [{"image 1": "data:image/jpeg;base64,..."}, ...].

    Returns:
        types.Content with text and image parts.
    """
    content_parts = [types.Part(text=message)]
    for img_dict in image_input:
        for key, base64_data in img_dict.items():
            try:
                content_parts.append(decode_data_uri_to_part(base64_data))
            except Exception as e:
                logger.warning(f"Failed to decode image '{key}': {e}")
    return types.Content(role="user", parts=content_parts)

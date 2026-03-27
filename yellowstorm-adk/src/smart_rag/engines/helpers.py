import base64

from google.genai import types

from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.engines.helpers")


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

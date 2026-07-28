"""Model-specific request parameter compatibility helpers."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any


_model_input_modalities: ContextVar[dict[str, frozenset[str]]] = ContextVar(
    "model_input_modalities", default={}
)


def normalize_temperature_for_model(model_name: object, temperature: float | None) -> float | None:
    """Return a temperature accepted by the target model family."""
    if temperature is None:
        return None
    if _is_gpt5_model(model_name):
        return 1
    return temperature


def normalize_messages_for_model(model_name: object, messages: Any) -> Any:
    """Remove content blocks unsupported by the request-local model capability."""
    modalities = _model_input_modalities.get().get(str(model_name or ""))
    if modalities is None or not isinstance(messages, list):
        return messages

    allowed_content_types = {"text"}
    if "image" in modalities:
        allowed_content_types.add("image_url")

    normalized_messages = []
    changed = False
    for message in messages:
        if not isinstance(message, dict) or not isinstance(message.get("content"), list):
            normalized_messages.append(message)
            continue

        content = message["content"]
        text_parts = [
            part
            for part in content
            if isinstance(part, dict) and part.get("type") in allowed_content_types
        ]
        if len(text_parts) == len(content):
            normalized_messages.append(message)
            continue

        normalized_messages.append({**message, "content": text_parts or None})
        changed = True

    return normalized_messages if changed else messages


def register_model_input_modalities(model_name: object, modalities: Any) -> None:
    """Register model capabilities in the current async request context."""
    model_key = str(model_name or "").strip()
    if not model_key:
        return
    normalized = frozenset(
        modality for modality in (modalities or []) if modality in {"text", "image"}
    )
    if "text" not in normalized:
        normalized = frozenset({"text"})
    registry = dict(_model_input_modalities.get())
    registry[model_key] = normalized
    _model_input_modalities.set(registry)


def resolve_model_config(model_config: object) -> str:
    """Return the model identifier while retaining structured capabilities."""
    if not isinstance(model_config, dict):
        return str(model_config or "")
    model_name = str(model_config.get("provider") or model_config.get("name") or "")
    register_model_input_modalities(model_name, model_config.get("input_modalities"))
    return model_name


def _is_gpt5_model(model_name: object) -> bool:
    if isinstance(model_name, dict):
        model_name = model_name.get("provider") or model_name.get("name")
    return "gpt-5" in str(model_name or "").lower()

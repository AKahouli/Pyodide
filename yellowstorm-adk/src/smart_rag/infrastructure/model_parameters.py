"""Model-specific request parameter compatibility helpers."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any


_model_input_modalities: ContextVar[dict[str, frozenset[str]]] = ContextVar(
    "model_input_modalities", default={}
)
_model_reasoning_efforts: ContextVar[dict[str, str]] = ContextVar(
    "model_reasoning_efforts", default={}
)
_model_context_windows: ContextVar[dict[str, int]] = ContextVar(
    "model_context_windows", default={}
)
# Request-scoped compaction config, resolved once from the primary chat model's
# config (see resolve_model_config). None means "no compaction for this request".
_request_compaction: ContextVar["RequestCompactionConfig | None"] = ContextVar(
    "request_compaction", default=None
)


@dataclass(frozen=True)
class RequestCompactionConfig:
    """Resolved compaction inputs for one chat request (token_threshold already
    derived from token_fraction * context window). Consumed by the runner builder
    in infrastructure/compaction.py to construct an ADK EventsCompactionConfig."""

    compaction_interval: int | None
    overlap_size: int | None
    token_threshold: int | None
    event_retention_size: int | None
    summarizer_model: str


def set_request_compaction_config(config: "RequestCompactionConfig | None") -> None:
    _request_compaction.set(config)


def get_request_compaction_config() -> "RequestCompactionConfig | None":
    return _request_compaction.get()


def _resolve_request_compaction(
    compaction: dict, model_name: str, context_window: int | None
) -> "RequestCompactionConfig | None":
    """Turn the request's raw compaction dict into resolved runner inputs, or None
    when disabled / no trigger is usable. Sliding-window needs a positive interval;
    the token trigger needs a positive fraction AND a known context window."""
    if not compaction.get("enabled"):
        return None
    interval = int(compaction.get("compaction_interval") or 0)
    overlap = int(compaction.get("overlap_size") or 0)
    fraction = float(compaction.get("token_fraction") or 0.0)
    retention = int(compaction.get("event_retention_size") or 0)

    sliding = interval > 0
    token_threshold = (
        int(fraction * context_window)
        if fraction > 0 and context_window and context_window > 0
        else None
    )
    if not sliding and not token_threshold:
        return None
    return RequestCompactionConfig(
        compaction_interval=interval if sliding else None,
        overlap_size=overlap if sliding else None,
        token_threshold=token_threshold,
        event_retention_size=retention if token_threshold else None,
        summarizer_model=str(compaction.get("summarizer_model") or "").strip()
        or model_name,
    )


def normalize_temperature_for_model(model_name: object, temperature: float | None) -> float | None:
    """Return a temperature accepted by the target model family."""
    if temperature is None:
        return None
    if _requires_temperature_one(model_name):
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


def get_reasoning_effort_for_model(model_name: object) -> str | None:
    return _model_reasoning_efforts.get().get(str(model_name or ""))


def get_context_window_for_model(model_name: object) -> int | None:
    requested = str(model_name or "")
    registry = _model_context_windows.get()
    exact = registry.get(requested)
    if exact is not None:
        return exact

    matches = {
        context_window
        for configured_model, context_window in registry.items()
        if configured_model.endswith(f"/{requested}") or requested.endswith(f"/{configured_model}")
    }
    return matches.pop() if len(matches) == 1 else None


def resolve_model_config(model_config: object) -> str:
    """Return the model identifier while retaining structured capabilities."""
    if not isinstance(model_config, dict):
        return str(model_config or "")
    model_name = str(model_config.get("provider") or model_config.get("name") or "")
    register_model_input_modalities(model_name, model_config.get("input_modalities"))
    reasoning_effort = model_config.get("reasoning_effort")
    if isinstance(reasoning_effort, str) and reasoning_effort:
        registry = dict(_model_reasoning_efforts.get())
        registry[model_name] = reasoning_effort
        _model_reasoning_efforts.set(registry)
    context_window = model_config.get("context_window_tokens")
    if isinstance(context_window, int) and context_window > 0:
        registry = dict(_model_context_windows.get())
        registry[model_name] = context_window
        _model_context_windows.set(registry)
    compaction = model_config.get("compaction")
    if isinstance(compaction, dict):
        resolved = _resolve_request_compaction(
            compaction,
            model_name,
            context_window if isinstance(context_window, int) and context_window > 0 else None,
        )
        # Only the primary chat model carries compaction; sub-agent configs omit
        # it, so a None here from a sub-agent must not clobber the request config.
        if resolved is not None:
            set_request_compaction_config(resolved)
    return model_name


# Model families whose API rejects any temperature other than 1 (reasoning
# models with no sampling-temperature knob). Add here, not a one-off check,
# as more of these show up -- e.g. kimi-k3: "invalid temperature: only 1 is
# allowed for this model".
_FIXED_TEMPERATURE_ONE_MARKERS = ("gpt-5", "gpt-6", "kimi")


def _requires_temperature_one(model_name: object) -> bool:
    if isinstance(model_name, dict):
        model_name = model_name.get("provider") or model_name.get("name")
    name = str(model_name or "").lower()
    return any(marker in name for marker in _FIXED_TEMPERATURE_ONE_MARKERS)

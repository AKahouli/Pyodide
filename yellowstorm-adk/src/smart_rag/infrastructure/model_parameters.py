"""Model-specific request parameter compatibility helpers."""

from __future__ import annotations


def normalize_temperature_for_model(model_name: object, temperature: float | None) -> float | None:
    """Return a temperature accepted by the target model family."""
    if temperature is None:
        return None
    if _is_gpt5_model(model_name):
        return 1
    return temperature


def _is_gpt5_model(model_name: object) -> bool:
    if isinstance(model_name, dict):
        model_name = model_name.get("provider") or model_name.get("name")
    return "gpt-5" in str(model_name or "").lower()

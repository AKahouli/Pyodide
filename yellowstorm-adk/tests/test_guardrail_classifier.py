from types import SimpleNamespace

import pytest

from src.guardrails.classifier import classify_prompt_injection


def response(content: str) -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


@pytest.mark.asyncio
@pytest.mark.parametrize("content", ["[]", '"allow"', "null"])
async def test_classifier_fails_open_for_non_object_json(monkeypatch, content: str) -> None:
    async def completion(**_kwargs):
        return response(content)

    monkeypatch.setattr("src.guardrails.classifier.acompletion", completion)
    decision = await classify_prompt_injection("text", "model", "policy", "input")
    assert decision.decision == "allow"
    assert decision.error == "invalid_classifier_json"


@pytest.mark.asyncio
async def test_classifier_fails_open_for_non_numeric_confidence(monkeypatch) -> None:
    async def completion(**_kwargs):
        return response('{"decision":"block","confidence":"high"}')

    monkeypatch.setattr("src.guardrails.classifier.acompletion", completion)
    decision = await classify_prompt_injection("text", "model", "policy", "input")
    assert decision.decision == "allow"
    assert decision.error == "invalid_classifier_json"


@pytest.mark.asyncio
async def test_classifier_blocks_provider_detected_jailbreak(monkeypatch) -> None:
    async def completion(**_kwargs):
        raise RuntimeError("content_filter: jailbreak detected")

    monkeypatch.setattr("src.guardrails.classifier.acompletion", completion)
    decision = await classify_prompt_injection("text", "model", "policy", "input")

    assert decision.decision == "block"
    assert decision.reason == "provider_jailbreak_filter"
    assert decision.error == ""


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("model", "omit_temperature", "expected_temperature"),
    [("gpt-5.4-nano", True, None), ("gpt-5.4-nano", False, 0), ("gpt-4o-mini", True, None)],
)
async def test_classifier_uses_admin_model_temperature_capability(monkeypatch, model: str, omit_temperature: bool, expected_temperature: int | None) -> None:
    captured: dict = {}

    async def completion(**kwargs):
        captured.update(kwargs)
        return response('{"decision":"block","confidence":1}')

    monkeypatch.setattr("src.guardrails.classifier.acompletion", completion)
    decision = await classify_prompt_injection("text", model, "policy", "input", omit_temperature)

    assert decision.decision == "block"
    if expected_temperature is None:
        assert "temperature" not in captured
    else:
        assert captured["temperature"] == expected_temperature
    assert captured["api_base"]
    assert captured["api_key"]

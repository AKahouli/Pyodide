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

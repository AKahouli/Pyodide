"""AttributeExtractionAgent: value mapping and evidence-reference honesty.

The LLM is stubbed so the test asserts the contract, not a model response.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.semantic_model import attribute_extractor
from src.semantic_model.attribute_extractor import AttributeExtractionAgent


def request() -> dict[str, Any]:
    return {
        "modelId": "model-1",
        "conceptId": "contract",
        "conceptLabel": "Contract",
        "documentId": "doc-1",
        "fileName": "master-agreement-0041.pdf",
        "attributes": [
            {"key": "contract_number", "label": "Contract number", "type": "string"},
            {"key": "customer_id", "label": "Customer id", "type": "string"},
            {"key": "title", "label": "Title", "type": "string"},
        ],
        "sections": [
            {"sectionPk": 7, "blockPk": 9, "content": "Contract number CNT-2026-0041 Customer ID C041"},
        ],
    }


class StubLlm:
    """Mirrors semantica's LiteLLM.generate_structured(prompt) -> dict."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.prompts: list[str] = []

    def generate_structured(self, prompt: str) -> dict[str, Any]:
        self.prompts.append(prompt)
        return self.payload


def install_stub(monkeypatch: pytest.MonkeyPatch, payload: dict[str, Any]) -> StubLlm:
    stub = StubLlm(payload)
    monkeypatch.setattr(AttributeExtractionAgent, "_dependencies",
                        staticmethod(lambda: (lambda text: text, lambda **_: stub)))
    return stub


def payload(instances: list[dict[str, Any]]) -> dict[str, Any]:
    return {"extractions": [{"conceptKey": "contract", "instances": instances}]}


def test_maps_model_attributes_and_keeps_only_supplied_references(monkeypatch: pytest.MonkeyPatch):
    stub = install_stub(monkeypatch, payload([{
        "label": "CNT-2026-0041",
        "attributes": [
            {"key": "contract_number", "value": "CNT-2026-0041",
             "evidenceReferences": ["section:7/block:9", "section:999/block:999"]},
            {"key": "customer_id", "value": "C041", "evidenceReferences": ["section:7/block:9"]},
        ],
        "evidenceReferences": ["section:7/block:9"],
        "confidence": 0.9,
    }]))

    result = AttributeExtractionAgent().extract(request())

    assert result["extractorVersion"] == attribute_extractor.AI_EXTRACTOR_VERSION
    assert {item["key"]: item["value"] for item in result["values"]} == {
        "contract_number": "CNT-2026-0041", "customer_id": "C041"}
    # The invented locator never reaches the caller.
    contract_number = next(item for item in result["values"] if item["key"] == "contract_number")
    assert contract_number["evidenceReferences"] == ["section:7/block:9"]
    assert result["failed"] == ["title"]
    # The prompt carries the caller's evidence, not a fabricated one.
    assert "CNT-2026-0041 Customer ID C041" in stub.prompts[0]
    assert "master-agreement-0041.pdf" in stub.prompts[0]


def test_empty_evidence_short_circuits_without_calling_the_model(monkeypatch: pytest.MonkeyPatch):
    stub = install_stub(monkeypatch, payload([]))
    request_without_sections = {**request(), "sections": []}

    result = AttributeExtractionAgent().extract(request_without_sections)

    assert result["values"] == []
    assert result["failed"] == ["contract_number", "customer_id", "title"]
    assert stub.prompts == []


def test_first_instance_wins_when_the_model_returns_several(monkeypatch: pytest.MonkeyPatch):
    install_stub(monkeypatch, payload([
        {"label": "A", "attributes": [{"key": "customer_id", "value": "first",
                                       "evidenceReferences": ["section:7/block:9"]}]},
        {"label": "B", "attributes": [{"key": "customer_id", "value": "second",
                                       "evidenceReferences": ["section:7/block:9"]}]},
    ]))

    result = AttributeExtractionAgent().extract(request())

    assert [item["value"] for item in result["values"] if item["key"] == "customer_id"] == ["first"]

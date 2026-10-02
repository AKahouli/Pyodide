"""Single-instance attribute extraction for the semantic-model population runtime.

Reuses Stage 1 of the mapping pipeline (`NodeExtractor`) so the prompts and LLM
plumbing stay in one place. Unlike the mapping pipeline this module does not
resolve, merge or detect edges: it returns the values the model read from the
evidence the caller supplied, and it discards any evidence reference the caller
did not send so an invented locator can never reach storage.
"""

from __future__ import annotations

from typing import Any

from src.config.settings import get_settings

from .node_extractor import NodeExtractor

# Bumped when the extraction contract or prompt changes, so stored provenance
# distinguishes revisions produced by different extractors.
AI_EXTRACTOR_VERSION = "ai-attribute-v1"

# Most records one document may give when a mapping reads several per document.
MAX_RECORDS = 500


class AttributeExtractionAgent:
    """Extract one instance's attributes from one document's evidence."""

    def extract(self, request: dict[str, Any]) -> dict[str, Any]:
        attributes = [item for item in (request.get("attributes") or [])
                      if isinstance(item, dict) and item.get("key")]
        evidence = self._evidence(request.get("sections") or [])
        if not attributes or not evidence:
            return self._empty(attributes)

        concept_id = request["conceptId"]
        allowed_references = {item["reference"] for item in evidence}
        node_type = {
            "id": concept_id,
            "key": concept_id,
            "label": request.get("conceptLabel") or concept_id,
            "attributes": [{
                "key": item["key"],
                "label": item.get("label") or item["key"],
                "type": item.get("type") or "string",
                "description": item.get("description") or "",
            } for item in attributes],
        }
        search_tasks = [{
            "target": {"kind": "node_type", "id": concept_id},
            "fileName": request.get("fileName") or "",
            "sourceDocumentId": request.get("documentId") or "",
            "evidence": evidence,
        }]

        normalize_text, LiteLLM = self._dependencies()
        settings = get_settings()
        # An administrator can point the seeded default agent at another model.
        model = request.get("model") or settings.SEMANTIC_MODEL_ONTOLOGY_MODEL
        llm_kwargs: dict[str, Any] = {
            "model": model,
            "api_key": settings.LITELLM_API_SECRET_KEY,
            "api_base": settings.LITELLM_API_BASE_URL,
            "timeout": settings.SEMANTIC_MODEL_LLM_TIMEOUT_SECONDS,
        }
        max_tokens = getattr(settings, "SEMANTIC_MODEL_LLM_MAX_TOKENS", 0)
        if max_tokens and max_tokens > 0:
            llm_kwargs["max_tokens"] = max_tokens

        nodes = NodeExtractor().extract(
            {"nodes": [node_type]}, search_tasks, LiteLLM(**llm_kwargs), normalize_text,
            concurrency=1, batch_size=1)

        keys = [item["key"] for item in attributes]
        values: dict[str, dict[str, Any]] = {}
        records: list[dict[str, Any]] = []
        for node in nodes:
            own: dict[str, dict[str, Any]] = {}
            for attribute in node.get("attributes") or []:
                key = attribute.get("key")
                if not key or key in own:
                    continue
                own[key] = {
                    "key": key,
                    "value": attribute.get("value"),
                    "evidenceReferences": [str(reference)
                                           for reference in attribute.get("evidenceReferences") or []
                                           if str(reference) in allowed_references],
                }
                values.setdefault(key, own[key])
            if own:
                records.append({"label": node.get("label") or "",
                                "values": [own[key] for key in keys if key in own]})
        result: dict[str, Any] = {
            "model": model,
            "extractorVersion": AI_EXTRACTOR_VERSION,
            "values": [values[key] for key in keys if key in values],
            "failed": [key for key in keys if key not in values],
        }
        # Several records per document: every instance the model found, each with its own values.
        if request.get("multiple"):
            result["records"] = records[:MAX_RECORDS]
        return result

    @staticmethod
    def _evidence(sections: list[Any]) -> list[dict[str, Any]]:
        """Evidence items carry only what the model needs plus a stable reference."""
        evidence: list[dict[str, Any]] = []
        for section in sections:
            if not isinstance(section, dict):
                continue
            content = section.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            reference = f"section:{section.get('sectionPk')}/block:{section.get('blockPk')}"
            evidence.append({"quote": content, "reference": reference})
        return evidence

    @staticmethod
    def _empty(attributes: list[dict[str, Any]]) -> dict[str, Any]:
        return {"extractorVersion": AI_EXTRACTOR_VERSION, "values": [], "records": [],
                "failed": [item["key"] for item in attributes]}

    @staticmethod
    def _dependencies() -> tuple[Any, Any]:
        try:
            from semantica.llms import LiteLLM
            from semantica.normalize import normalize_text
        except ImportError as error:
            raise RuntimeError("Semantica is required for attribute extraction") from error
        return normalize_text, LiteLLM

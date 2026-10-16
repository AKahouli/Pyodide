"""Autonomous semantic extraction through the runtime's own LiteLLM profile.

No backend inference bridge, ADK imports or agent-library resolution. The
non-secret identity is pinned by admission and checked again before inference.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import random
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

from .extraction_prompt import PROMPT_VERSION, extraction_prompt, looks_like_filename, meaningful_value, normalize_text

AI_EXTRACTOR_VERSION = "ai-attribute-v2"
MAX_EVIDENCE_SECTIONS = 200
MAX_RECORDS = 500
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 4
BASE_DELAY_SECONDS = 2.0
MAX_DELAY_SECONDS = 60.0


class AttributeExtractionError(Exception):
    """Stable failure code; gateway response bodies and credentials stay private."""

    def __init__(self, code: str, *, status_code: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class ExtractionProfile:
    base_url: str
    api_key: str = field(repr=False)
    model: str
    max_tokens: int = 32000
    timeout_seconds: float = 240.0
    parallel_calls: int = 8

    @property
    def identity(self) -> dict[str, Any]:
        return {"profileId": "semantic-runtime", "model": self.model,
                "contractVersion": AI_EXTRACTOR_VERSION, "promptVersion": PROMPT_VERSION,
                "maxTokens": self.max_tokens}

    @property
    def completion_url(self) -> str:
        return self.base_url + ("/chat/completions" if self.base_url.endswith("/v1") else "/v1/chat/completions")


def profile_from_env() -> ExtractionProfile:
    """Deployment owns the profile; callers cannot override the model or gateway."""
    base_url = os.environ.get("SEMANTIC_AI_BASE_URL", "").strip().rstrip("/")
    api_key = os.environ.get("SEMANTIC_AI_API_KEY", "").strip()
    model = os.environ.get("SEMANTIC_AI_MODEL", "").strip()
    if not base_url or not api_key or not model:
        raise AttributeExtractionError("ai_extraction_not_configured")
    try:
        url = urlsplit(base_url)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError
        max_tokens = int(os.environ.get("SEMANTIC_AI_MAX_TOKENS", "32000"))
        timeout = float(os.environ.get("SEMANTIC_AI_TIMEOUT_SECONDS", "240"))
        parallel = int(os.environ.get("SEMANTIC_AI_PARALLEL_CALLS", "8"))
        if not (1 <= max_tokens <= 128000 and math.isfinite(timeout) and 1 <= timeout <= 600 and 1 <= parallel <= 64):
            raise ValueError
    except ValueError as exc:
        raise AttributeExtractionError("ai_extraction_configuration_invalid") from exc
    return ExtractionProfile(base_url, api_key, model, max_tokens, timeout, parallel)


def validate_identity(identity: dict[str, Any] | None) -> ExtractionProfile:
    if not identity:
        raise AttributeExtractionError("ai_extraction_identity_missing")
    if not isinstance(identity, dict) or "agentSlug" in identity or identity.get("contractVersion") != AI_EXTRACTOR_VERSION:
        raise AttributeExtractionError("ai_extraction_identity_incompatible_rebuild_required")
    profile = profile_from_env()
    if identity != profile.identity:
        raise AttributeExtractionError("ai_extraction_profile_changed_rebuild_required")
    return profile


def _retry_delay(attempt: int, retry_after: str | None) -> float:
    if retry_after:
        try:
            delay = float(retry_after)
            if math.isfinite(delay):
                return min(MAX_DELAY_SECONDS, max(0.0, delay))
        except ValueError:
            pass
    return min(MAX_DELAY_SECONDS, BASE_DELAY_SECONDS * 2 ** attempt) * (0.5 + random.random() / 2)


def uses_ai_extraction(payload: dict[str, Any]) -> bool:
    """Whether document, cell or derived mappings can call the shared AI reader."""
    for entry in [*(payload.get("sources") or []), *(payload.get("derivations") or [])]:
        if not isinstance(entry, dict):
            continue
        mappings = entry.get("fieldMappings") or []
        if isinstance(mappings, list) and any(
                isinstance(item, dict) and item.get("mode") == "extract"
                and item.get("extractionStrategy") in ("ai", "rules_then_ai") for item in mappings):
            return True
        extractions = entry.get("fieldExtractions") or {}
        if isinstance(extractions, dict) and any(
                isinstance(item, dict) and item.get("extractionStrategy") in ("ai", "rules_then_ai")
                for item in extractions.values()):
            return True
    return False


async def _completion(profile: ExtractionProfile, prompt: str, http: httpx.AsyncClient,
                      response_key: str = "extractions") -> dict[str, Any]:
    body = {"model": profile.model, "messages": [{"role": "user", "content": prompt + "\n\nReturn the response as valid JSON only."}],
            "max_tokens": profile.max_tokens, "response_format": {"type": "json_object"}}
    response = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = await http.post(profile.completion_url, json=body,
                                       headers={"Authorization": f"Bearer {profile.api_key}", "Accept-Encoding": "identity"},
                                       timeout=httpx.Timeout(profile.timeout_seconds, connect=10))
        except httpx.TimeoutException as exc:
            raise AttributeExtractionError("attribute_extraction_unavailable") from exc
        except httpx.TransportError as exc:
            if attempt == MAX_ATTEMPTS - 1:
                raise AttributeExtractionError("attribute_extraction_unavailable") from exc
            await asyncio.sleep(_retry_delay(attempt, None))
            continue
        if response.status_code in RETRY_STATUSES and attempt < MAX_ATTEMPTS - 1:
            await asyncio.sleep(_retry_delay(attempt, response.headers.get("retry-after")))
            continue
        break
    if response is None or response.status_code >= 400:
        code = "attribute_extraction_throttled" if response is not None and response.status_code == 429 else "attribute_extraction_unavailable"
        raise AttributeExtractionError(code, status_code=response.status_code if response is not None else None)
    try:
        choice = response.json()["choices"][0]
        if choice.get("finish_reason") not in (None, "stop") or choice["message"].get("refusal"):
            raise ValueError
        text = choice["message"]["content"]
        if not isinstance(text, str):
            raise ValueError
        try:
            result = json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if not match:
                raise ValueError
            result = json.loads(match.group())
        if not isinstance(result, dict) or not isinstance(result.get(response_key), list):
            raise ValueError
        return result
    except (KeyError, IndexError, TypeError, ValueError, AttributeError) as exc:
        raise AttributeExtractionError("invalid_attribute_extraction_response") from exc


def _map_result(result: dict[str, Any], concept_id: str, concept_label: str, attributes: list[dict[str, Any]],
                references: set[str], profile: ExtractionProfile, multiple: bool) -> dict[str, Any]:
    keys = [item["key"] for item in attributes]
    allowed_keys = set(keys)
    values: dict[str, dict[str, Any]] = {}
    records = []
    found_concept = False
    for extraction in result["extractions"]:
        if not isinstance(extraction, dict) or str(extraction.get("conceptKey") or "").strip().casefold() not in {
                concept_id.strip().casefold(), concept_label.strip().casefold()}:
            continue
        found_concept = True
        instances = extraction.get("instances")
        if not isinstance(instances, list):
            raise AttributeExtractionError("invalid_attribute_extraction_response")
        for instance in instances:
            if not isinstance(instance, dict):
                raise AttributeExtractionError("invalid_attribute_extraction_response")
            label = str(instance.get("label") or "").strip()
            if not label or looks_like_filename(label):
                continue
            raw = instance.get("attributes") or []
            if isinstance(raw, dict):
                raw = [{"key": key, "value": value} for key, value in raw.items()]
            if not isinstance(raw, list):
                raise AttributeExtractionError("invalid_attribute_extraction_response")
            own = {}
            for item in raw:
                if not isinstance(item, dict):
                    continue
                key = item.get("key")
                if not isinstance(key, str) or key not in allowed_keys or key in own or not meaningful_value(item.get("value")):
                    continue
                supplied = item.get("evidenceReferences") or []
                if not isinstance(supplied, list):
                    continue
                own[key] = {"key": key, "value": item["value"],
                            "evidenceReferences": [str(ref) for ref in supplied if str(ref) in references]}
                values.setdefault(key, own[key])
            if own:
                records.append({"label": label, "values": [own[key] for key in keys if key in own]})
            if len(records) >= MAX_RECORDS:
                break
    if not found_concept:
        raise AttributeExtractionError("invalid_attribute_extraction_response")
    output = {"model": profile.model, "extractorVersion": AI_EXTRACTOR_VERSION,
              "values": [values[key] for key in keys if key in values],
              "failed": [key for key in keys if key not in values]}
    if multiple:
        output["records"] = records[:MAX_RECORDS]
    return output


async def extract_attributes(
    *, model_id: str, concept_id: str, concept_label: str, document_id: str, file_name: str,
    attributes: list[dict[str, Any]], sections: list[dict[str, Any]],
    ai_extraction: dict[str, Any] | None = None, multiple: bool = False,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Infer locally; document/cell readers still enforce grounding and typed values."""
    if not attributes or not sections:
        raise AttributeExtractionError("no_evidence")
    profile = validate_identity(ai_extraction)
    evidence = [{"quote": normalize_text(item["content"]),
                 "reference": f"section:{item.get('sectionPk')}/block:{item.get('blockPk')}"}
                for item in sections[:MAX_EVIDENCE_SECTIONS]
                if isinstance(item, dict) and isinstance(item.get("content"), str) and item["content"].strip()]
    if not evidence:
        raise AttributeExtractionError("no_evidence")
    specs = [{"key": item["key"], "label": item.get("label") or item["key"],
              "type": item.get("type") or "string", "description": item.get("description") or ""}
             for item in attributes if isinstance(item, dict) and isinstance(item.get("key"), str) and item["key"]]
    if not specs:
        raise AttributeExtractionError("no_evidence")
    concept = {"conceptKey": concept_id, "label": concept_label or concept_id,
               "description": "", "aliases": [], "attributes": specs}
    prompt = extraction_prompt(concept, evidence, file_name)
    loop = asyncio.get_running_loop()
    semaphores = getattr(loop, "_semantic_extraction_capacity", None)
    if semaphores is None:
        semaphores = {}
        setattr(loop, "_semantic_extraction_capacity", semaphores)
    semaphore = semaphores.setdefault(profile.parallel_calls, asyncio.Semaphore(profile.parallel_calls))
    http = client or httpx.AsyncClient()
    try:
        # Total budget includes capacity waits, retries and backoff.
        async with asyncio.timeout(profile.timeout_seconds):
            async with semaphore:
                result = await _completion(profile, prompt, http)
        return _map_result(result, concept_id, concept_label or concept_id, specs,
                           {item["reference"] for item in evidence}, profile, multiple)
    except TimeoutError as exc:
        raise AttributeExtractionError("attribute_extraction_unavailable") from exc
    finally:
        if client is None:
            await http.aclose()

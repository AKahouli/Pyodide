"""AI attribute extraction through the backend's trusted internal endpoint.

The runtime never talks to the ADK directly: the backend owns the admin-managed
extraction agent and the ADK credentials. This client only carries the evidence
the runtime already read from the logical index.
"""

from __future__ import annotations

import asyncio
import os
import random
from typing import Any

import httpx

from .asset_delivery import _api_prefix, _backend_url

MAX_EVIDENCE_SECTIONS = 200
# Throttled (429) or the AI briefly down (502, 504, unreachable): wait and try again, a few times.
RETRY_STATUSES = {429, 502, 504}
MAX_ATTEMPTS = 4
BASE_DELAY_SECONDS = 2.0
MAX_DELAY_SECONDS = 60.0


def _retry_delay(attempt: int, retry_after: str | None) -> float:
    """Seconds to wait before attempt ``attempt + 1``: the server's ``Retry-After`` when given,
    else an exponential backoff with jitter so parallel calls do not retry together."""
    if retry_after:
        try:
            return min(MAX_DELAY_SECONDS, max(0.0, float(retry_after)))
        except ValueError:
            pass
    return min(MAX_DELAY_SECONDS, BASE_DELAY_SECONDS * 2 ** attempt) * (0.5 + random.random() / 2)


class AttributeExtractionError(Exception):
    """Raised when the extraction dependency cannot answer."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def extract_attributes(
    *,
    model_id: str,
    concept_id: str,
    concept_label: str,
    document_id: str,
    file_name: str,
    attributes: list[dict[str, Any]],
    sections: list[dict[str, Any]],
    ai_extraction: dict[str, Any] | None = None,
    multiple: bool = False,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Ask the extraction agent for one record's mapped attribute values, or every record's when ``multiple``."""
    token = os.environ.get("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "")
    if not token:
        raise AttributeExtractionError("internal_service_token_missing")
    if not attributes or not sections:
        raise AttributeExtractionError("no_evidence")
    if not ai_extraction:
        raise AttributeExtractionError("ai_extraction_identity_missing")
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10))
    body = {
        "modelId": model_id,
        "conceptId": concept_id,
        "conceptLabel": concept_label,
        "documentId": document_id,
        "fileName": file_name,
        "attributes": attributes,
        "sections": sections[:MAX_EVIDENCE_SECTIONS],
        "aiExtraction": ai_extraction,
        **({"multiple": True} if multiple else {}),
    }
    response = None
    try:
        for attempt in range(MAX_ATTEMPTS):
            last = attempt == MAX_ATTEMPTS - 1
            try:
                response = await http.post(
                    f"{_backend_url()}/{_api_prefix()}/semantic-model/internal/attribute-extraction",
                    json=body, headers={"X-Internal-Token": token, "Accept-Encoding": "identity"})
            except httpx.TimeoutException as exc:
                # Already waited the whole budget: another try would double it.
                raise AttributeExtractionError("attribute_extraction_unavailable") from exc
            except httpx.TransportError as exc:
                if last:
                    raise AttributeExtractionError("attribute_extraction_unavailable") from exc
                await asyncio.sleep(_retry_delay(attempt, None))
                continue
            except httpx.HTTPError as exc:
                raise AttributeExtractionError("attribute_extraction_unavailable") from exc
            if response.status_code in RETRY_STATUSES and not last:
                await asyncio.sleep(_retry_delay(attempt, response.headers.get("retry-after")))
                continue
            break
    finally:
        if own_client:
            await http.aclose()
    if response.status_code == 429:
        raise AttributeExtractionError("attribute_extraction_throttled")
    if response.status_code >= 400:
        raise AttributeExtractionError("attribute_extraction_unavailable")
    try:
        payload = response.json()
    except ValueError as exc:
        raise AttributeExtractionError("invalid_attribute_extraction_response") from exc
    if not isinstance(payload, dict):
        raise AttributeExtractionError("invalid_attribute_extraction_response")
    data = payload.get("data", payload)
    if not isinstance(data, dict) or not isinstance(data.get("values"), list):
        raise AttributeExtractionError("invalid_attribute_extraction_response")
    return data

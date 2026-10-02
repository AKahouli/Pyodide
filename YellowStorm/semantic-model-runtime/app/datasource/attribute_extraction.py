"""AI attribute extraction through the backend's trusted internal endpoint.

The runtime never talks to the ADK directly: the backend owns the admin-managed
extraction agent and the ADK credentials. This client only carries the evidence
the runtime already read from the logical index.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from .asset_delivery import _api_prefix, _backend_url

MAX_EVIDENCE_SECTIONS = 200


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
    try:
        response = await http.post(
            f"{_backend_url()}/{_api_prefix()}/semantic-model/internal/attribute-extraction",
            json={
                "modelId": model_id,
                "conceptId": concept_id,
                "conceptLabel": concept_label,
                "documentId": document_id,
                "fileName": file_name,
                "attributes": attributes,
                "sections": sections[:MAX_EVIDENCE_SECTIONS],
                "aiExtraction": ai_extraction,
                **({"multiple": True} if multiple else {}),
            },
            headers={"X-Internal-Token": token, "Accept-Encoding": "identity"},
        )
    except httpx.HTTPError as exc:
        raise AttributeExtractionError("attribute_extraction_unavailable") from exc
    finally:
        if own_client:
            await http.aclose()
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

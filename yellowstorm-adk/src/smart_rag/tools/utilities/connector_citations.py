"""Structured connector citation normalization shared by tools and presentation."""
from typing import Any
from urllib.parse import urlparse


def display_source_name(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if parsed.scheme and parsed.netloc:
        path = parsed.path.rstrip("/")
        if path:
            candidate = path.rsplit("/", 1)[-1].strip()
            if candidate:
                return candidate
    normalized = text.rstrip("/")
    if "/" in normalized:
        candidate = normalized.rsplit("/", 1)[-1].strip()
        if candidate:
            return candidate
    return text


def normalize_vectorstore_source(value: Any) -> str:
    text = str(value or "").strip()
    prefix = "s3://vectorstore/"
    return text[len(prefix):] if text.startswith(prefix) else text


def normalize_connector_citations(citations: list) -> list[dict]:
    sources, seen = [], set()
    for index, citation in enumerate(citations):
        if not isinstance(citation, dict):
            continue
        raw_source = citation.get("source") or citation.get("path") or ""
        source = normalize_vectorstore_source(raw_source)
        page = str(citation.get("page") or citation.get("page_number") or "").strip()
        highlight_text = str(citation.get("highlight_text") or citation.get("highlightText") or citation.get("page_content") or "")
        signature = (source, page, highlight_text)
        if signature in seen:
            continue
        seen.add(signature)
        bbox = citation.get("highlight_bbox") or citation.get("highlightBBox") or []
        sources.append({
            "type": "text", "source": source, "file_name": display_source_name(raw_source),
            "page": page, "page_content": highlight_text,
            "workspace_id": str(citation.get("workspace_id") or citation.get("workspace_name") or ""),
            "reference": str(citation.get("reference") or citation.get("citation") or index + 1),
            "reference_aliases": [], "highlight_text": highlight_text,
            "highlight_bbox": bbox, "block_bbox": bbox,
            **({"document_id": str(citation["document_id"])} if citation.get("document_id") else {}),
        })
    return sources

import json
import unicodedata
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

from .contracts import WebSearchCandidate

_LIST_PATHS = ("results", "items", "sources", "data.results", "data.items")
_FIELD_DEFAULTS = {
    "title": ("title", "name"),
    "url": ("url", "href", "link"),
    "snippet": ("snippet", "body", "description", "text"),
    "content": ("content",),
    "publishedAt": ("publishedAt", "published_at", "date"),
    "author": ("author",),
    "prefix": ("prefix",),
    "suffix": ("suffix",),
}
_MAX_RESULTS = 20


def normalize_web_text(value: str) -> str:
    normalized = unicodedata.normalize("NFC", str(value or "")).replace("\u00a0", " ")
    return "\n".join(" ".join(line.split()) for line in normalized.replace("\r\n", "\n").replace("\r", "\n").split("\n"))


def contains_exact_text(page_content: str, exact_text: str) -> bool:
    exact = normalize_web_text(exact_text)
    return bool(exact) and exact in normalize_web_text(page_content)


def _path(value: Any, path: str) -> Any:
    current = value
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _first(item: dict[str, Any], paths: Iterable[str]) -> str:
    for path in paths:
        value = _path(item, path)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _http_url(value: str) -> str:
    try:
        parsed = urlparse(value)
    except ValueError:
        return ""
    return value if parsed.scheme.lower() in {"http", "https"} and parsed.netloc else ""


def _coerce_payload(raw: Any) -> Any:
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw
    if isinstance(raw, dict) and isinstance(raw.get("text"), str):
        try:
            parsed_text = json.loads(raw["text"])
        except json.JSONDecodeError:
            return raw
        if isinstance(parsed_text, (dict, list)):
            return parsed_text
    return raw


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _items(payload: Any, mapping: dict[str, Any], result_kind: str) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    configured = str(mapping.get("itemsPath") or mapping.get("items_path") or "").strip()
    paths = (configured,) if configured else _LIST_PATHS
    for path in paths:
        value = _path(payload, path)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return [payload] if result_kind == "web_fetch" else []


def normalize_web_connector_response(
    raw: Any,
    result_kind: str,
    citation_mode: str,
    result_mapping: Any,
    *,
    connector_id: str = "",
    connector_slug: str = "",
    action_key: str = "",
) -> Any:
    if result_kind not in {"web_search", "web_fetch"}:
        return raw
    payload = _coerce_payload(raw)
    mapping = _mapping(result_mapping)
    configured_fields = mapping.get("fields") if isinstance(mapping.get("fields"), dict) else {}

    def paths_for(name: str) -> tuple[str, ...]:
        configured = configured_fields.get(name)
        if isinstance(configured, list):
            values = tuple(str(value) for value in configured if str(value).strip())
            if values:
                return values
        if configured_fields:
            return ()
        return _FIELD_DEFAULTS[name]

    candidates: list[WebSearchCandidate] = []
    seen: set[tuple[str, str]] = set()
    citation_sources: list[dict[str, str]] = []
    for item in _items(payload, mapping, result_kind)[:_MAX_RESULTS]:
        url = _http_url(_first(item, paths_for("url")))
        if not url:
            continue
        content = _first(item, paths_for("content"))
        snippet = _first(item, paths_for("snippet"))
        exact = content or snippet
        signature = (url, exact)
        if signature in seen:
            continue
        seen.add(signature)
        candidate = WebSearchCandidate(
            candidate_id=f"wsc_{len(candidates) + 1}",
            title=_first(item, paths_for("title")) or url,
            url=url,
            snippet=snippet or None,
            content=content or None,
            published_at=_first(item, paths_for("publishedAt")) or None,
            author=_first(item, paths_for("author")) or None,
            connector_id=connector_id,
            connector_slug=connector_slug,
            action_key=action_key,
        )
        candidates.append(candidate)
        if citation_mode in {"source_only", "text_fragment"}:
            source = {
                "type": "web",
                "source": url,
                "title": candidate.title,
                "exact_text": exact if citation_mode == "text_fragment" else "",
                "evidence_origin": "page_content" if content else "search_snippet",
                "connector_id": connector_id,
                "connector_slug": connector_slug,
                "action_key": action_key,
            }
            prefix = _first(item, paths_for("prefix"))
            suffix = _first(item, paths_for("suffix"))
            if prefix:
                source["prefix"] = prefix
            if suffix:
                source["suffix"] = suffix
            citation_sources.append(source)

    response = dict(raw) if isinstance(raw, dict) else {"text": str(raw)}
    response["web_sources"] = [
        {
            "candidate_id": candidate.candidate_id,
            "title": candidate.title,
            "url": candidate.url,
            **({"snippet": candidate.snippet} if candidate.snippet else {}),
            **({"content": candidate.content} if result_kind == "web_fetch" and candidate.content else {}),
        }
        for candidate in candidates
    ]
    if citation_sources:
        response["citation_sources"] = citation_sources
    return response

"""Shared helpers for artifact kind inference and semantic output-port routing."""

from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional


# Keep the current extension/MIME classification stable while centralizing it.
_ARTIFACT_KIND_BY_EXTENSION = {
    ".pdf": "document",
    ".doc": "document",
    ".docx": "document",
    ".odt": "document",
    ".rtf": "document",
    ".txt": "text",
    ".md": "text",
    ".py": "code",
    ".js": "code",
    ".ts": "code",
    ".tsx": "code",
    ".jsx": "code",
    ".java": "code",
    ".kt": "code",
    ".go": "code",
    ".rs": "code",
    ".c": "code",
    ".cpp": "code",
    ".h": "code",
    ".cs": "code",
    ".rb": "code",
    ".php": "code",
    ".sh": "code",
    ".bat": "code",
    ".sql": "code",
    ".r": "code",
    ".lua": "code",
    ".swift": "code",
    ".csv": "data",
    ".xlsx": "data",
    ".xls": "data",
    ".json": "data",
    ".xml": "data",
    ".yaml": "data",
    ".yml": "data",
    ".tsv": "data",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".bmp": "image",
    ".svg": "image",
    ".webp": "image",
    ".pptx": "document",
    ".ppt": "document",
    ".odp": "document",
}

_ARTIFACT_KIND_BY_MIME = {
    "application/pdf": "document",
    "application/msword": "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
    "text/plain": "text",
    "text/markdown": "text",
    "text/csv": "data",
    "application/json": "data",
    "application/xml": "data",
    "text/xml": "data",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "data",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/svg+xml": "image",
    "image/webp": "image",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
}

_FILENAME_PORT_HINTS = {
    ".docx": ["docx", "doc"],
    ".pptx": ["pptx", "ppt"],
    ".xlsx": ["xlsx", "xls", "excel"],
    ".doc": ["doc"],
    ".ppt": ["ppt"],
    ".xls": ["xls", "excel"],
    ".pdf": ["pdf"],
    ".md": ["md", "markdown"],
    ".txt": ["txt", "text"],
}

_FUZZY_MATCH_THRESHOLD = 0.5


def normalize_port_id(value: Any) -> str:
    raw = str(value or "default").strip() or "default"
    if raw.startswith(("in-", "out-")):
        return raw.split("-", 1)[1] or "default"
    return raw


def normalize_port_text(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "-")


def infer_artifact_kind(filename: str = "", mime_type: str = "") -> Optional[str]:
    lower_filename = str(filename or "").strip().lower()
    if "." in lower_filename:
        extension = lower_filename[lower_filename.rfind(".") :]
        inferred = _ARTIFACT_KIND_BY_EXTENSION.get(extension)
        if inferred:
            return inferred

    normalized_mime = str(mime_type or "").strip().lower()
    if normalized_mime:
        return _ARTIFACT_KIND_BY_MIME.get(normalized_mime)

    return None


def _filename_tokens(filename: str) -> List[str]:
    normalized_filename = str(filename or "").strip().lower()
    if not normalized_filename:
        return []

    tokens: List[str] = []
    stem = Path(normalized_filename).stem
    for candidate in [
        stem,
        stem.split("-", 1)[1] if stem.startswith(("out-", "in-")) else "",
    ]:
        token = normalize_port_text(candidate)
        if token and token not in tokens:
            tokens.append(token)

    suffix = Path(normalized_filename).suffix.lower()
    for candidate in [suffix[1:] if suffix else "", *(_FILENAME_PORT_HINTS.get(suffix, []))]:
        token = normalize_port_text(candidate)
        if token and token not in tokens:
            tokens.append(token)

    return tokens


def _port_matches_filename_token(port: Dict[str, Any], token: str) -> bool:
    normalized_token = normalize_port_text(token)
    if not normalized_token:
        return False

    for candidate in [port.get("id"), port.get("name")]:
        normalized_candidate = normalize_port_text(candidate)
        if normalized_candidate and (
            normalized_candidate == normalized_token
            or normalized_token in normalized_candidate
        ):
            return True
    return False


def _fuzzy_score(query: str, text: str) -> float:
    normalized_query = normalize_port_text(query)
    normalized_text = normalize_port_text(text)
    if not normalized_query or not normalized_text:
        return 0.0
    return SequenceMatcher(None, normalized_query, normalized_text).ratio()


def semantic_match_output_port(
    output_ports: List[Dict[str, Any]],
    *,
    preferred_kind: str = "",
    filename: str = "",
    label: str = "",
    allow_single_compatible: bool = True,
) -> Optional[Dict[str, Any]]:
    # Filter by kind first so semantic matching only compares compatible targets.
    normalized_kind = str(preferred_kind or "").strip()
    candidates = [
        port
        for port in (output_ports or [])
        if not normalized_kind
        or str(port.get("artifact_kind") or port.get("artifactKind") or "").strip()
        == normalized_kind
    ]
    if not candidates:
        return None
    if allow_single_compatible and len(candidates) == 1:
        return candidates[0]

    for candidate in _filename_tokens(filename):
        for port in candidates:
            if _port_matches_filename_token(port, candidate):
                return port

    query = normalize_port_text(Path(str(filename or "")).stem if filename else label)
    if not query:
        return None

    ranked = sorted(
        candidates,
        key=lambda port: max(
            _fuzzy_score(query, str(port.get(field) or ""))
            for field in ("id", "name", "description")
        ),
        reverse=True,
    )
    top_score = max(
        _fuzzy_score(query, str(ranked[0].get(field) or ""))
        for field in ("id", "name", "description")
    )
    if top_score >= _FUZZY_MATCH_THRESHOLD:
        return ranked[0]
    return None

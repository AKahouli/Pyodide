"""Deterministic R1 datasource discovery (Phase 3, P3.3-P3.4).

Pure stdlib only. No LLM, no network, no database, no file I/O in this
slice: the worker supplies verified Workspace metadata, this module resolves
``assetRef`` + versioned ``discovery-profile`` shapes and archive-safety /
ingestion-plan decisions. Missing values stay missing; file/index reads land
in later slices (dataset preparation, Phase 4 index adapter).
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Protocol

PARSER_VERSION = "r1-discovery-v1"

# Reuses the NestJS buffered-parse gate concept (50 MB) for preview bounds.
MAX_COMPRESSED_BYTES = 50 * 1024 * 1024
MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 1000

_HEX24 = re.compile(r"^[a-f0-9]{24}$")
_HEX32 = re.compile(r"^[a-f0-9]{32}$")
_HEX64 = re.compile(r"^[a-f0-9]{64}$")

_TABULAR_MIMES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/csv": "csv",
}
# A zip of .eml files (or one .eml) is read as three tables, like a workbook.
_EMAIL_ARCHIVE_MIMES = {"application/zip", "application/x-zip-compressed", "message/rfc822"}
MAX_EMAIL_ARCHIVE_BYTES = 1024 * 1024 * 1024


def max_source_bytes(mime_type: Any) -> int:
    return MAX_EMAIL_ARCHIVE_BYTES if mime_type in _EMAIL_ARCHIVE_MIMES else MAX_COMPRESSED_BYTES


def is_email_archive(mime_type: Any) -> bool:
    return mime_type in _EMAIL_ARCHIVE_MIMES


_DOCUMENT_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
# Live Workspace contract (document-status.enum.ts) reports indexing readiness
# as IndexingStatus.READY='ready'; Phase 0 fixtures captured 'completed'.
# Both mean the existing logical index is available.
INDEX_COMPLETE = {"ready", "completed"}


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _is_hex24(value: Any) -> bool:
    return isinstance(value, str) and _HEX24.match(value) is not None


def _observation_suffix(source: dict[str, Any]) -> str:
    """Version-specific observation id fragment (no fingerprint available).

    A bare ``obs:<assetId>:1`` collides across re-uploads and later index
    observations sharing one immutable profile id. The suffix derives from
    the stable observation fields instead, so distinct observations never
    share an ``assetVersionId``. Fixture ``obs:…:1`` values illustrate the
    shape, not the exact suffix.
    """
    probe = {"uploadedAt": source.get("uploadedAt"), "sizeBytes": source.get("sizeBytes"),
             "indexObservationId": source.get("indexObservationId"),
             "indexingStatus": source.get("indexingStatus")}
    return hashlib.sha256(_canonical(probe).encode()).hexdigest()[:8]


def resolve_asset_ref(source: dict[str, Any]) -> dict[str, Any]:
    """Resolve a verified ``assetRef`` from Workspace metadata.

    ``contentHash`` is the nullable backend-buffered MD5 (32 hex), a
    ``md5:``/``sha256:`` tagged fingerprint, or absent (presigned uploads).
    Never derives identity from filenames.
    """
    workspace_id = source.get("workspaceId")
    asset_id = source.get("assetId")
    if not _is_hex24(workspace_id) or not _is_hex24(asset_id):
        raise ValueError("invalid_asset_identity")
    raw_hash = source.get("contentHash")
    fingerprint = str(raw_hash).strip().lower() if isinstance(raw_hash, str) and raw_hash.strip() else ""
    index_obs = source.get("indexObservationId")
    index_obs = index_obs if isinstance(index_obs, str) and index_obs else None

    if fingerprint.startswith("sha256:") and _HEX64.match(fingerprint[7:]):
        return {"workspaceId": workspace_id, "assetId": asset_id,
                "assetVersionId": fingerprint, "sourceVersionVerification": "verified",
                "indexObservationId": index_obs}
    if fingerprint.startswith("md5:") and _HEX32.match(fingerprint[4:]):
        return {"workspaceId": workspace_id, "assetId": asset_id,
                "assetVersionId": fingerprint, "sourceVersionVerification": "partial",
                "indexObservationId": index_obs}
    if _HEX32.match(fingerprint):
        return {"workspaceId": workspace_id, "assetId": asset_id,
                "assetVersionId": f"md5:{fingerprint}", "sourceVersionVerification": "partial",
                "indexObservationId": index_obs}
    if _HEX64.match(fingerprint):
        return {"workspaceId": workspace_id, "assetId": asset_id,
                "assetVersionId": f"sha256:{fingerprint}", "sourceVersionVerification": "verified",
                "indexObservationId": index_obs}
    # No usable content fingerprint: semantic-owned observation only.
    verification = "partial" if source.get("indexingStatus") in INDEX_COMPLETE else "unknown"
    return {"workspaceId": workspace_id, "assetId": asset_id,
            "assetVersionId": f"obs:{asset_id}:{_observation_suffix(source)}",
            "sourceVersionVerification": verification, "indexObservationId": index_obs}


class SourceAuthorizationVerifier(Protocol):
    """Authoritative, execution-time source authorization.

    The frozen contract requires current authorization on every read and
    forbids relying on cached grants after revocation, so the worker asks the
    authoritative Workspace service at execution time. A job payload may not
    assert its own authorization.
    """

    def __call__(self, *, actor_user_id: str, home_workspace_id: str,
                 source_workspace_id: str) -> bool: ...


def deny_cross_workspace_verifier(*, actor_user_id: str, home_workspace_id: str,
                                  source_workspace_id: str) -> bool:
    """Default verifier: no authoritative service client is wired yet.

    Cross-workspace discovery therefore fails closed instead of trusting a
    caller-provided grant. The NestJS-side authorization client (plan P2.2 /
    P3.1) replaces this; same-workspace discovery does not need it.
    """
    return False


def requires_cross_workspace_authorization(home_workspace_id: Any,
                                           source_workspace_id: Any) -> bool:
    """True when the canonical home workspace differs from the source.

    Both must be real strings: an absent home workspace is rejected by the
    caller before this point, never inferred from the payload.
    """
    if not isinstance(home_workspace_id, str) or not home_workspace_id:
        return True
    return home_workspace_id != source_workspace_id


def parser_fingerprint(options: dict[str, Any] | None) -> str:
    body = {"parser": PARSER_VERSION, "options": options or {}}
    digest = hashlib.sha256(_canonical(body).encode()).hexdigest()
    return f"sha256:{digest}"


def discovery_profile_id(asset_ref: dict[str, Any], fingerprint: str) -> str:
    """One profile per file and version: the same bytes uploaded twice are two files, two profiles."""
    key = f"{asset_ref['workspaceId']}|{asset_ref['assetId']}|{asset_ref['assetVersionId']}|{fingerprint}"
    digest = hashlib.sha256(key.encode()).hexdigest()
    return f"prof_{digest[:12]}"


def validate_archive_safety(*, detected_format: str, compressed_bytes: int | None,
                            decompressed_bytes: int | None = None,
                            entry_count: int | None = None,
                            paths: list[str] | None = None) -> list[dict[str, str]]:
    """Bounded archive safety checks (P3.6). Raises on path traversal."""
    warnings: list[dict[str, str]] = []
    if compressed_bytes is not None and compressed_bytes > MAX_COMPRESSED_BYTES:
        warnings.append({"code": "source_too_large",
                         "message": "Compressed source exceeds the bounded preview budget."})
    if decompressed_bytes is not None and decompressed_bytes > MAX_DECOMPRESSED_BYTES:
        warnings.append({"code": "source_too_large",
                         "message": "Decompressed source exceeds the bounded preview budget."})
    if entry_count is not None and entry_count > MAX_ARCHIVE_ENTRIES:
        warnings.append({"code": "archive_too_many_entries",
                         "message": "Archive entry count exceeds the bounded preview budget."})
    for path in paths or []:
        normalized = str(path).replace("\\", "/")
        if normalized.startswith("/") or ".." in normalized.split("/") or ":" in normalized:
            raise ValueError("archive_path_traversal")
    if detected_format in ("xlsx", "docx"):
        warnings.append({"code": "no_formula_execution",
                         "message": "Macros, formulas and external links are never executed."})
    return warnings


def _structure_hint(source: dict[str, Any], kind: str) -> dict[str, Any]:
    if kind == "xlsx":
        sheets = source.get("sheets")
        if isinstance(sheets, list) and sheets:
            return {"kind": "xlsx", "sheets": sheets}
        return {"kind": "xlsx"}
    if kind == "email_archive":
        return {"kind": "email_archive"}
    if kind == "csv":
        return {"kind": "csv", "delimiter": source.get("delimiter", ","),
                "encoding": source.get("encoding", "utf-8-sig"),
                "headerRow": source.get("headerRow", 1)}
    counts = {key: source[key] for key in ("sections", "blocks")
              if isinstance(source.get(key), int)}
    structure: dict[str, Any] = {"kind": "document"}
    structure.update(counts)
    if isinstance(source.get("visualContentPending"), bool):
        structure["visualContentPending"] = source["visualContentPending"]
    return structure


def discover(source: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a versioned, bounded discovery profile from verified metadata."""
    asset_ref = resolve_asset_ref(source)
    fingerprint = parser_fingerprint(options)
    mime = source.get("mimeType") if isinstance(source.get("mimeType"), str) else ""
    indexing = source.get("indexingStatus")
    warnings: list[dict[str, str]] = []

    if source.get("protected") is True:
        status, structure = "protected", {}
        warnings.append({"code": "protected_source", "message": "Source is protected; no samples taken."})
    elif source.get("corrupt") is True:
        status, structure = "corrupt", {}
        warnings.append({"code": "corrupt_source", "message": "Source failed validation; not retried automatically."})
    # Spreadsheets are read straight from the uploaded file, so their indexing state does not matter.
    elif mime in _TABULAR_MIMES:
        kind = _TABULAR_MIMES[mime]
        size = source.get("sizeBytes")
        if isinstance(size, int) and size > MAX_COMPRESSED_BYTES:
            status, structure = "partial", _structure_hint(source, kind)
            warnings.append({"code": "source_too_large_for_preview",
                             "message": "Preview is bounded; full preparation runs as a batch job."})
        else:
            status, structure = "ready", _structure_hint(source, kind)
    elif mime in _EMAIL_ARCHIVE_MIMES:
        size = source.get("sizeBytes")
        if isinstance(size, int) and size > MAX_EMAIL_ARCHIVE_BYTES:
            status, structure = "unsupported", {}
            warnings.append({"code": "source_too_large",
                             "message": "The e-mail archive exceeds the 1 GB reading budget; split it into several archives."})
        else:
            status, structure = "ready", _structure_hint(source, "email_archive")
    elif mime in _DOCUMENT_MIMES and indexing == "failed":
        status, structure = "indexing_required", {}
        warnings.append({"code": "indexing_required",
                         "message": "Population needs the existing logical index; re-run the unchanged upload/indexing workflow."})
    elif mime in _DOCUMENT_MIMES:
        if indexing in INDEX_COMPLETE:
            status, structure = "ready", _structure_hint(source, "document")
        else:
            status, structure = "indexing_required", _structure_hint(source, "document")
            warnings.append({"code": "indexing_required",
                             "message": "Document outline comes from the existing index; the asset is not indexed yet."})
    else:
        status, structure = "unsupported", {}
        warnings.append({"code": "unsupported_format",
                         "message": f"Format is not a Release 1 source: {mime or 'unknown'}."})

    if not isinstance(source.get("contentHash"), str) or not source.get("contentHash"):
        warnings.append({"code": "unverified_version",
                         "message": "No content fingerprint; source-version-dependent acceptance requires review."})
    if structure.get("kind") != "email_archive":
        warnings.extend(validate_archive_safety(
            detected_format=structure.get("kind", "unknown"),
            compressed_bytes=source.get("sizeBytes") if isinstance(source.get("sizeBytes"), int) else None))
    # ponytail: metadata-only slice ships no samples; file/index reads are later slices
    return {"profileId": discovery_profile_id(asset_ref, fingerprint),
            "profileRevision": 1, "assetRef": asset_ref, "parserFingerprint": fingerprint,
            "status": status, "metadata": _metadata(source),
            "structure": structure, "samples": [], "warnings": warnings,
            "semanticFindings": [],
            "coverage": {"sampled": False, "completeProfileDone": False}}


def _metadata(source: dict[str, Any]) -> dict[str, Any]:
    """Schema-valid metadata: absent strings stay absent (never null).

    ``originalName``/``mimeType`` permit only strings when present, so a
    missing value is omitted rather than serialized as ``None``.
    """
    metadata: dict[str, Any] = {}
    for key in ("originalName", "mimeType"):
        value = source.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or not value:
            raise ValueError("invalid_source")
        metadata[key] = value
    size = source.get("sizeBytes")
    if size is not None and (isinstance(size, bool) or not isinstance(size, int) or size < 0):
        raise ValueError("invalid_source")
    metadata["sizeBytes"] = size
    for key in ("contentHash", "uploadedAt", "indexingStatus"):
        value = source.get(key)
        metadata[key] = value if value is None or isinstance(value, str) else None
        if value is not None and not isinstance(value, str):
            raise ValueError("invalid_source")
    return metadata


def plan_ingestion(profile: dict[str, Any]) -> dict[str, str]:
    """Deterministic ingestion decision (P3.11). A profile never authorizes extraction."""
    status = profile.get("status")
    kind = profile.get("structure", {}).get("kind") if isinstance(profile.get("structure"), dict) else None
    if status == "indexing_required":
        return {"decision": "require_indexing", "reason": "existing logical index is required first"}
    if status in ("unsupported", "protected", "corrupt"):
        return {"decision": status, "reason": f"source status is {status}"}
    if status == "ready" and kind in ("xlsx", "csv", "email_archive"):
        return {"decision": "prepare_dataset", "reason": "approved tabular source prepares a versioned dataset"}
    if status == "ready" and kind == "document":
        return {"decision": "read_via_index", "reason": "document evidence reads go through the Phase 4 index adapter"}
    if status == "partial":
        return {"decision": "prepare_dataset", "reason": "bounded preview is partial; full preparation runs as batch"}
    return {"decision": "request_clarification", "reason": "profile does not support an ingestion decision yet"}


def preview_source(source: dict[str, Any], options: dict[str, Any] | None = None,
                   data: bytes | None = None) -> dict[str, Any]:
    """Bounded preview: profile + ingestion plan.

    Without bytes this is the metadata-only profile (no samples). With bytes
    for a tabular source it runs the bounded deterministic parser (P3.7-P3.10)
    and fills structure/samples/coverage; field profiles and the content
    fingerprint travel alongside the schema-bound profile.
    """
    profile = discover(source, options)
    # Only a ready profile may enter byte parsing. Terminal states carry no
    # samples by contract, and a size-capped partial profile must keep its
    # status and warning even when the supplied bytes happen to be smaller
    # than the declared metadata: parsing must never upgrade it to ready.
    if data is None or profile["status"] != "ready":
        return {"profile": profile, "ingestionPlan": plan_ingestion(profile)}
    from .parsers import parse_csv_preview, parse_xlsx_preview

    mime = source.get("mimeType") if isinstance(source.get("mimeType"), str) else ""
    if mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        parsed = parse_xlsx_preview(data, options)
    elif mime == "text/csv":
        parsed = parse_csv_preview(data, options)
    elif mime in _EMAIL_ARCHIVE_MIMES:
        from .email_archive import parse_email_archive_preview
        parsed = parse_email_archive_preview(data, mime, options)
    else:
        raise ValueError("unsupported_format_for_bytes")
    profile = {**profile,
               "structure": parsed["structure"],
               "samples": parsed["samples"],
               "warnings": [w for w in profile["warnings"] if w["code"] == "unverified_version"]
                           + parsed["warnings"],
               "coverage": parsed["coverage"],
               "status": "ready" if parsed["coverage"]["completeProfileDone"] else "partial"}
    return {"profile": profile, "ingestionPlan": plan_ingestion(profile),
            "fieldProfiles": parsed["fieldProfiles"],
            "contentFingerprint": parsed["contentFingerprint"],
            "scannedRows": parsed["scannedRows"]}

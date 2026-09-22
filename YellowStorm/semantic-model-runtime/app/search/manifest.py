"""Authorized query contexts (P7.18, P7.3-SB03). Pure stdlib.

A context binds an actor to a model/version/revision plus an explicit source
scope and expiry. Every evidence page rechecks source authorization against
the live grant; the manifest itself is never an authorization grant. Times are
epoch seconds for testability; persistence serializes ISO-8601 UTC.
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Any

from app.population.compiler import PopulationError

DEFAULT_CONTEXT_TTL_SECONDS = 3600
MAX_CONTEXT_TTL_SECONDS = 86400


def _epoch(now: Any) -> int:
    if now is None:
        return int(time.time())
    if isinstance(now, bool) or not isinstance(now, (int, float)) or now < 0:
        raise PopulationError("invalid_context_time")
    return int(now)


def _iso(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def build_context_manifest(*, actor_user_id: Any, model_id: Any, model_version_id: Any,
                           data_revision_id: Any, source_scope: Any,
                           required_sources: Any = None,
                           ttl_seconds: int = DEFAULT_CONTEXT_TTL_SECONDS,
                           now: Any = None) -> dict[str, Any]:
    for name, value in (("actorUserId", actor_user_id), ("modelId", model_id),
                        ("modelVersionId", model_version_id),
                        ("dataRevisionId", data_revision_id)):
        if not isinstance(value, str) or not value.strip():
            raise PopulationError(f"invalid_context_{name.lower()}")
    if not isinstance(source_scope, list) or not source_scope:
        raise PopulationError("invalid_context_scope")
    scope: list[dict[str, str]] = []
    for entry in source_scope:
        if not isinstance(entry, dict):
            raise PopulationError("invalid_context_scope")
        workspace_id = entry.get("workspaceId")
        asset_id = entry.get("assetId")
        if (not isinstance(workspace_id, str) or not workspace_id
                or not isinstance(asset_id, str) or not asset_id):
            raise PopulationError("invalid_context_scope")
        scope.append({"workspaceId": workspace_id, "assetId": asset_id})
    scope.sort(key=lambda item: (item["workspaceId"], item["assetId"]))
    if any(scope[i] == scope[i + 1] for i in range(len(scope) - 1)):
        raise PopulationError("invalid_context_scope")
    if required_sources is None:
        required: list[Any] = []
    elif not isinstance(required_sources, list) or any(
            not isinstance(item, dict) for item in required_sources):
        raise PopulationError("invalid_context_scope")
    else:
        required = list(required_sources)
    if (isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int)
            or not 1 <= ttl_seconds <= MAX_CONTEXT_TTL_SECONDS):
        raise PopulationError("invalid_context_ttl")
    moment = _epoch(now)
    fingerprint = json.dumps({"actor": actor_user_id, "model": model_id,
                              "version": model_version_id, "revision": data_revision_id,
                              "scope": scope}, sort_keys=True, separators=(",", ":"))
    context_id = "ctx_" + hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:24]
    return {
        "contextId": context_id, "actorUserId": actor_user_id, "modelId": model_id,
        "modelVersionId": model_version_id, "dataRevisionId": data_revision_id,
        "sourceScope": scope,
        "requiredSources": required,
        "coverage": {"sourcesEnumerated": len(scope), "complete": True},
        "expiresAt": _iso(moment + ttl_seconds),
    }


def context_expired(manifest: dict[str, Any], now: Any = None) -> bool:
    try:
        expiry = datetime.fromisoformat(str(manifest.get("expiresAt"))).timestamp()
    except (ValueError, TypeError) as exc:
        raise PopulationError("invalid_context_expiry") from exc
    return _epoch(now) >= int(expiry)

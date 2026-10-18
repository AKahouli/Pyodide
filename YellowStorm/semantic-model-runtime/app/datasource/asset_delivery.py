"""Authorized, bounded Workspace asset delivery for datasource workers."""

from __future__ import annotations

import hashlib
import asyncio
import os
import json
from contextvars import ContextVar, Token
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from .datasets import MAX_DATASET_BYTES
from .discovery import max_source_bytes, resolve_asset_ref


_execution: ContextVar[dict[str, Any] | None] = ContextVar("semantic_asset_execution", default=None)


def bind_asset_execution(lease: Any) -> Token:
    """Install only a repository-claimed execution; request selectors cannot bind it.

    The admission is never interpreted as actor authority by this process: the
    backend verifies its signature and scope against canonical DB state each time.
    """
    payload = lease.payload.get("payload") if isinstance(lease.payload, dict) else None
    admission = payload.get("assetAdmission") if isinstance(payload, dict) else None
    capability = getattr(lease, "asset_capability", "")
    if not isinstance(admission, str) or not admission or not isinstance(capability, str) or len(capability) != 64:
        raise RuntimeError("asset_execution_authority_missing")
    return _execution.set({"jobId": lease.job_id, "taskId": lease.task_id,
                           "leaseEpoch": lease.lease_epoch, "leaseOwner": lease.lease_owner,
                           "capability": capability,
                           "sourceScopes": ([{"source": payload.get("source"), "options": payload.get("options", {})}]
                                            if "source" in payload else payload.get("sources", []))})


def reset_asset_execution(token: Token) -> None:
    _execution.reset(token)


def _principal_headers() -> dict[str, str]:
    token = os.environ.get("SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN", "")
    if not token:
        raise RuntimeError("semantic_runtime_backend_service_token_missing")
    return {"X-Yellowstorm-Service-Principal": "semantic-runtime", "X-Yellowstorm-Service-Token": token}


async def _asset_headers(http: httpx.AsyncClient, source: dict[str, Any], operation: str,
                         target: dict[str, Any] | None = None) -> dict[str, str]:
    proof = _execution.get()
    if proof is None:
        raise RuntimeError("asset_execution_authority_missing")
    headers = _principal_headers()
    resource = None
    if operation in {"dataset-put", "dataset-get", "derived-put"}:
        resource = dict(target or {})
        scopes = [entry.get("options") or {} for entry in proof.get("sourceScopes", [])
                  if isinstance(entry, dict) and isinstance(entry.get("source"), dict)
                  and entry["source"].get("workspaceId") == source.get("workspaceId")
                  and entry["source"].get("assetId") == source.get("assetId")]
        if resource.get("options") is None:
            # Archive derivation is whole-source work: select the first admitted
            # scope. Dataset readers with several distinct scopes must name one.
            distinct = {json.dumps(options, sort_keys=True): options for options in scopes}
            if not distinct or (len(distinct) > 1 and operation != "derived-put"):
                raise RuntimeError("asset_options_scope_required")
            resource["options"] = next(iter(distinct.values()))
    # No reusable long-lived asset bearer or tuple-only refresh. Every operation
    # mints afresh and independently rechecks the live lease + capability digest.
    response = await http.post(
        f"{_backend_url()}/{_api_prefix()}/workspaces/internal/semantic-asset-grant",
        headers=headers,
        json={**{k: v for k, v in proof.items() if k != "sourceScopes"},
              "workspaceId": source.get("workspaceId"), "assetId": source.get("assetId"),
              "operation": operation, **({"target": resource} if resource is not None else {})},
        follow_redirects=False,
    )
    if response.is_redirect:
        raise AssetFetchError("asset_grant_redirected")
    if response.status_code in {401, 403}:
        raise AssetFetchError("asset_execution_forbidden")
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("token"), str) or not payload["token"]:
        raise AssetFetchError("invalid_asset_grant_response")
    return {**headers, "X-Semantic-Asset-Grant": payload["token"]}


def asset_fetch_wall_seconds(source: dict[str, Any]) -> int:
    """35 s for an ordinary file; a large e-mail archive also gets 1 s per 10 MB."""
    size = source.get("sizeBytes")
    extra = size // (10 * 1024 * 1024) if isinstance(size, int) and not isinstance(size, bool) and size > 0 else 0
    return 35 + min(extra, 5400)


class AssetFetchError(ValueError):
    """Deterministic source failure that should not consume retry budget."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _backend_url() -> str:
    raw = os.environ.get("YELLOWSTORM_BACKEND_URL", "").rstrip("/")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        raise RuntimeError("invalid_backend_url")
    return raw


def _api_prefix() -> str:
    prefix = os.environ.get("YELLOWSTORM_BACKEND_API_PREFIX", "api").strip("/")
    if not prefix or "/" in prefix or prefix in {".", ".."}:
        raise RuntimeError("invalid_backend_api_prefix")
    return prefix


def _required_header(response: httpx.Response, name: str) -> str:
    value = response.headers.get(name)
    if not value:
        raise AssetFetchError("invalid_asset_response")
    return value


def _authoritative_source(response: httpx.Response) -> dict[str, Any]:
    try:
        size = int(_required_header(response, "x-yellowstorm-source-size"))
    except ValueError as exc:
        raise AssetFetchError("invalid_asset_response") from exc
    source: dict[str, Any] = {
        "workspaceId": _required_header(response, "x-yellowstorm-workspace-id"),
        "assetId": _required_header(response, "x-yellowstorm-asset-id"),
        "sizeBytes": size,
        "mimeType": _required_header(response, "content-type").split(";", 1)[0].strip(),
        "indexingStatus": _required_header(response, "x-yellowstorm-indexing-status"),
    }
    for header, key in (("x-yellowstorm-content-hash", "contentHash"),
                        ("x-yellowstorm-uploaded-at", "uploadedAt")):
        value = response.headers.get(header)
        if value:
            source[key] = value
    return source


def _validate_metadata(expected: dict[str, Any], current: dict[str, Any],
                       response: httpx.Response, archive_mb: int | None = None) -> int:
    if current["workspaceId"] != expected.get("workspaceId") or current["assetId"] != expected.get("assetId"):
        raise AssetFetchError("asset_identity_mismatch")
    if current["mimeType"] != expected.get("mimeType"):
        raise AssetFetchError("asset_changed")
    size = current["sizeBytes"]
    if size < 0 or size > max_source_bytes(current["mimeType"], archive_mb):
        raise AssetFetchError("source_too_large")
    expected_size = expected.get("sizeBytes")
    if isinstance(expected_size, int) and not isinstance(expected_size, bool) and size != expected_size:
        raise AssetFetchError("asset_changed")
    content_length = response.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) != size:
                raise AssetFetchError("asset_changed")
        except ValueError as exc:
            raise AssetFetchError("invalid_asset_response") from exc
    if resolve_asset_ref(current)["assetVersionId"] != resolve_asset_ref(expected)["assetVersionId"]:
        raise AssetFetchError("asset_changed")
    return size


def _verify_content_hash(body: bytes, fingerprint: Any) -> None:
    if not isinstance(fingerprint, str):
        return
    value = fingerprint.strip().lower()
    if value.startswith("md5:"):
        algorithm, expected = "md5", value[4:]
    elif value.startswith("sha256:"):
        algorithm, expected = "sha256", value[7:]
    elif len(value) == 32:
        algorithm, expected = "md5", value
    elif len(value) == 64:
        algorithm, expected = "sha256", value
    else:
        return
    actual = hashlib.new(algorithm, body).hexdigest()
    if actual != expected:
        raise AssetFetchError("asset_changed")


class _HashCheck:
    """Incremental check of the stored content fingerprint, if there is one."""

    def __init__(self, fingerprint: Any) -> None:
        value = fingerprint.strip().lower() if isinstance(fingerprint, str) else ""
        self.algorithm = self.expected = None
        if value.startswith("md5:"):
            self.algorithm, self.expected = "md5", value[4:]
        elif value.startswith("sha256:"):
            self.algorithm, self.expected = "sha256", value[7:]
        elif len(value) == 32:
            self.algorithm, self.expected = "md5", value
        elif len(value) == 64:
            self.algorithm, self.expected = "sha256", value
        self.digest = hashlib.new(self.algorithm) if self.algorithm else None

    def update(self, chunk: bytes) -> None:
        if self.digest is not None:
            self.digest.update(chunk)

    def verify(self) -> None:
        if self.digest is not None and self.digest.hexdigest() != self.expected:
            raise AssetFetchError("asset_changed")


async def fetch_workspace_asset(source: dict[str, Any], actor_user_id: str,
                                *, client: httpx.AsyncClient | None = None,
                                target: Path | None = None, archive_mb: int | None = None) -> bytes | Path:
    """Stream an identity-bound asset with redirects disabled and a hard cap.

    With ``target`` the bytes go to that file and its path is returned: large
    e-mail archives are never held in memory. ``archive_mb`` is the admin's size limit for an
    e-mail archive (the run limits), asked of the back end too.
    """
    own_client = client is None
    http = client or httpx.AsyncClient(
        timeout=httpx.Timeout(30, connect=5), follow_redirects=False,
        headers={"Accept-Encoding": "identity"},
    )
    try:
        url = f"{_backend_url()}/{_api_prefix()}/workspaces/internal/semantic-asset"
        async with http.stream(
            "GET", url,
            params={"actorUserId": actor_user_id, "workspaceId": source.get("workspaceId", ""),
                    "documentId": source.get("assetId", ""),
                    **({"maxArchiveMb": archive_mb} if archive_mb else {})},
            headers={**await _asset_headers(http, source, "read"), "Accept-Encoding": "identity"},
        ) as response:
            if response.is_redirect:
                raise AssetFetchError("asset_redirected")
            if response.status_code == 403:
                raise AssetFetchError("workspace_forbidden")
            if response.status_code == 404:
                raise AssetFetchError("asset_not_found")
            if response.status_code == 409:
                raise AssetFetchError("asset_changed")
            if response.status_code == 413:
                raise AssetFetchError("source_too_large")
            if response.status_code in {400, 422}:
                raise AssetFetchError("asset_unavailable")
            response.raise_for_status()
            if response.headers.get("content-encoding") not in (None, "identity"):
                raise AssetFetchError("invalid_asset_response")
            current = _authoritative_source(response)
            expected_size = _validate_metadata(source, current, response, archive_mb)
            limit = max_source_bytes(current["mimeType"], archive_mb)
            check = _HashCheck(current.get("contentHash"))
            if target is not None:
                written = 0
                try:
                    with target.open("wb") as output:
                        async for chunk in response.aiter_raw():
                            written += len(chunk)
                            if written > limit:
                                raise AssetFetchError("source_too_large")
                            check.update(chunk)
                            await asyncio.to_thread(output.write, chunk)
                    if written != expected_size:
                        raise AssetFetchError("asset_changed")
                    check.verify()
                except BaseException:
                    target.unlink(missing_ok=True)
                    raise
                return target
            body = bytearray()
            async for chunk in response.aiter_raw():
                if len(body) + len(chunk) > limit:
                    raise AssetFetchError("source_too_large")
                body.extend(chunk)
            if len(body) != expected_size:
                raise AssetFetchError("asset_changed")
            result = bytes(body)
            _verify_content_hash(result, current.get("contentHash"))
            return result
    finally:
        if own_client:
            await http.aclose()


async def fetch_workspace_asset_metadata(source: dict[str, Any], actor_user_id: str,
                                         *, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    """Reauthorize an asset and return current metadata without reading bytes."""
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5), follow_redirects=False)
    try:
        response = await http.get(
            f"{_backend_url()}/{_api_prefix()}/workspaces/internal/semantic-asset-metadata",
            params={"actorUserId": actor_user_id, "workspaceId": source.get("workspaceId", ""),
                    "documentId": source.get("assetId", "")},
            headers=await _asset_headers(http, source, "metadata"),
        )
        if response.is_redirect:
            raise AssetFetchError("asset_redirected")
        if response.status_code == 403:
            raise AssetFetchError("workspace_forbidden")
        if response.status_code == 404:
            raise AssetFetchError("asset_not_found")
        if response.status_code in {400, 409, 413, 422}:
            raise AssetFetchError("asset_unavailable")
        response.raise_for_status()
        try:
            current = response.json()
        except ValueError as exc:
            raise AssetFetchError("invalid_asset_response") from exc
        if not isinstance(current, dict):
            raise AssetFetchError("invalid_asset_response")
        required = ("workspaceId", "assetId", "originalName", "mimeType", "sizeBytes")
        if any(current.get(key) is None for key in required):
            raise AssetFetchError("invalid_asset_response")
        if (current["workspaceId"] != source.get("workspaceId")
                or current["assetId"] != source.get("assetId")
                or current["mimeType"] != source.get("mimeType")):
            raise AssetFetchError("asset_changed")
        size = current["sizeBytes"]
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise AssetFetchError("invalid_asset_response")
        expected_size = source.get("sizeBytes")
        if isinstance(expected_size, int) and not isinstance(expected_size, bool) and size != expected_size:
            raise AssetFetchError("asset_changed")
        if resolve_asset_ref(current)["assetVersionId"] != resolve_asset_ref(source)["assetVersionId"]:
            raise AssetFetchError("asset_changed")
        return current
    finally:
        if own_client:
            await http.aclose()


async def upload_prepared_dataset(source: dict[str, Any], actor_user_id: str,
                                  manifest: dict[str, Any], path: Path,
                                  *, client: httpx.AsyncClient | None = None,
                                  options: dict[str, Any] | None = None) -> dict[str, Any]:
    size = path.stat().st_size
    content_hash = manifest.get("contentHash")
    if not isinstance(content_hash, str) or not content_hash.startswith("sha256:"):
        raise AssetFetchError("invalid_dataset_manifest")

    async def chunks():
        with path.open("rb") as handle:
            while chunk := await asyncio.to_thread(handle.read, 1024 * 1024):
                yield chunk

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), follow_redirects=False)
    try:
        response = await http.put(
            f"{_backend_url()}/{_api_prefix()}/workspaces/internal/semantic-dataset",
            params={"actorUserId": actor_user_id, "workspaceId": source.get("workspaceId", ""),
                    "documentId": source.get("assetId", ""), "datasetId": manifest.get("datasetId", "")},
            headers={**await _asset_headers(http, source, "dataset-put", {"datasetId": manifest.get("datasetId"), "options": options}), "Content-Type": "application/vnd.apache.parquet",
                     "Content-Length": str(size), "X-Content-SHA256": content_hash[7:]},
            content=chunks(),
        )
        if response.is_redirect:
            raise AssetFetchError("dataset_upload_redirected")
        if response.status_code == 403:
            raise AssetFetchError("workspace_forbidden")
        if response.status_code == 413:
            raise AssetFetchError("dataset_too_large")
        if response.status_code in {400, 404, 409, 422}:
            raise AssetFetchError("dataset_upload_rejected")
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError("invalid_dataset_response") from exc
        if (not isinstance(payload, dict) or payload.get("datasetId") != manifest.get("datasetId")
                or payload.get("sizeBytes") != size or payload.get("contentHash") != content_hash):
            raise RuntimeError("invalid_dataset_response")
        return payload
    finally:
        if own_client:
            await http.aclose()


async def fetch_prepared_dataset(source: dict[str, Any], actor_user_id: str,
                                  manifest: dict[str, Any], target: Path,
                                  *, client: httpx.AsyncClient | None = None,
                                  options: dict[str, Any] | None = None) -> Path:
    dataset_id = manifest.get("datasetId")
    expected_hash = manifest.get("contentHash")
    expected_size = manifest.get("sizeBytes")
    if (not isinstance(dataset_id, str) or not isinstance(expected_hash, str)
            or not expected_hash.startswith("sha256:") or isinstance(expected_size, bool)
            or not isinstance(expected_size, int) or not 1 <= expected_size <= MAX_DATASET_BYTES):
        raise AssetFetchError("invalid_dataset_manifest")
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), follow_redirects=False)
    target.unlink(missing_ok=True)
    try:
        async with http.stream(
            "GET", f"{_backend_url()}/{_api_prefix()}/workspaces/internal/semantic-dataset",
            params={"actorUserId": actor_user_id, "workspaceId": source.get("workspaceId", ""),
                    "documentId": source.get("assetId", ""), "datasetId": dataset_id},
            headers={**await _asset_headers(http, source, "dataset-get", {"datasetId": dataset_id, "options": options}), "Accept-Encoding": "identity"},
        ) as response:
            if response.is_redirect:
                raise AssetFetchError("dataset_download_redirected")
            if response.status_code == 403:
                raise AssetFetchError("workspace_forbidden")
            if response.status_code in {400, 404, 409, 413, 422}:
                raise AssetFetchError("dataset_unavailable")
            response.raise_for_status()
            try:
                size = int(response.headers.get("content-length", ""))
            except ValueError as exc:
                raise RuntimeError("invalid_dataset_response") from exc
            if (size != expected_size
                    or response.headers.get("content-type", "").split(";", 1)[0]
                    != "application/vnd.apache.parquet"
                    or response.headers.get("content-encoding", "identity") != "identity"
                    or response.headers.get("x-yellowstorm-workspace-id") != source.get("workspaceId")
                    or response.headers.get("x-yellowstorm-asset-id") != source.get("assetId")
                    or response.headers.get("x-yellowstorm-dataset-id") != dataset_id
                    or response.headers.get("x-yellowstorm-content-hash") != expected_hash):
                raise RuntimeError("invalid_dataset_response")
            digest = hashlib.sha256()
            written = 0
            with target.open("xb") as output:
                async for chunk in response.aiter_raw():
                    written += len(chunk)
                    if written > size or written > MAX_DATASET_BYTES:
                        raise RuntimeError("invalid_dataset_response")
                    digest.update(chunk)
                    output.write(chunk)
            if written != size or f"sha256:{digest.hexdigest()}" != expected_hash:
                raise RuntimeError("invalid_dataset_response")
        return target
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        if own_client:
            await http.aclose()


async def upload_derived_file(source: dict[str, Any], actor_user_id: str, entry: dict[str, Any],
                              path: Path, *, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    """Store one derived file (e-mail text or attachment) in the archive's workspace folder."""
    body = await asyncio.to_thread(path.read_bytes)
    if len(body) != entry.get("size") or hashlib.sha256(body).hexdigest() != entry.get("sha256"):
        raise AssetFetchError("derived_file_changed")
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(60, connect=5), follow_redirects=False)
    try:
        response = await http.put(
            f"{_backend_url()}/{_api_prefix()}/workspaces/internal/semantic-derived-file",
            params={"actorUserId": actor_user_id, "workspaceId": source.get("workspaceId", ""),
                    "documentId": source.get("assetId", ""), "fileName": entry.get("fileName", "")},
            headers={**await _asset_headers(http, source, "derived-put", {"fileName": entry.get("fileName")}), "Content-Type": entry.get("mimeType", ""),
                     "Content-Length": str(len(body)), "X-Content-SHA256": entry["sha256"]},
            content=body,
        )
        if response.is_redirect:
            raise AssetFetchError("derived_upload_redirected")
        if response.status_code == 403:
            raise AssetFetchError("workspace_forbidden")
        if response.status_code == 413:
            raise AssetFetchError("derived_file_too_large")
        if response.status_code in {400, 404, 409, 422}:
            raise AssetFetchError("derived_upload_rejected")
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError("invalid_derived_response") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("documentId"), str):
            raise RuntimeError("invalid_derived_response")
        return payload
    finally:
        if own_client:
            await http.aclose()

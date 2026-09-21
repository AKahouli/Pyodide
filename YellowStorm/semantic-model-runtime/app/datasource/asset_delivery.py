"""Authorized, bounded Workspace asset delivery for datasource workers."""

from __future__ import annotations

import hashlib
import asyncio
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from .datasets import MAX_DATASET_BYTES
from .discovery import MAX_COMPRESSED_BYTES, resolve_asset_ref


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
                       response: httpx.Response) -> int:
    if current["workspaceId"] != expected.get("workspaceId") or current["assetId"] != expected.get("assetId"):
        raise AssetFetchError("asset_identity_mismatch")
    if current["mimeType"] != expected.get("mimeType"):
        raise AssetFetchError("asset_changed")
    size = current["sizeBytes"]
    if size < 0 or size > MAX_COMPRESSED_BYTES:
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


async def fetch_workspace_asset(source: dict[str, Any], actor_user_id: str,
                                *, client: httpx.AsyncClient | None = None) -> bytes:
    """Stream an identity-bound asset with redirects disabled and a hard cap."""
    token = os.environ.get("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "")
    if not token:
        raise RuntimeError("internal_service_token_missing")
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
                    "documentId": source.get("assetId", "")},
            headers={"X-Internal-Token": token, "Accept-Encoding": "identity"},
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
            expected_size = _validate_metadata(source, current, response)
            body = bytearray()
            async for chunk in response.aiter_raw():
                if len(body) + len(chunk) > MAX_COMPRESSED_BYTES:
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


async def upload_prepared_dataset(source: dict[str, Any], actor_user_id: str,
                                  manifest: dict[str, Any], path: Path,
                                  *, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    token = os.environ.get("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "")
    if not token:
        raise RuntimeError("internal_service_token_missing")
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
            headers={"X-Internal-Token": token, "Content-Type": "application/vnd.apache.parquet",
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
                                 *, client: httpx.AsyncClient | None = None) -> Path:
    token = os.environ.get("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "")
    if not token:
        raise RuntimeError("internal_service_token_missing")
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
            headers={"X-Internal-Token": token, "Accept-Encoding": "identity"},
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

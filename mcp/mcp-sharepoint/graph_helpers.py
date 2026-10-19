"""Shared Microsoft Graph API helpers for M365 Document Connector."""

import json
import logging
import os
import sys
from contextvars import ContextVar
from typing import Any
from urllib.parse import quote

import httpx

# A dedicated stderr logger so the download path is traceable in container logs
# regardless of how the host configured logging. Never logs the token — only
# sizes, keys (which are paths, not secrets), and outcomes.
logger = logging.getLogger("sharepoint_mcp")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(asctime)s [sharepoint_mcp] %(message)s"))
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)
    logger.propagate = False

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# The caller's internal user id (X-user-id header) and the run this request
# belongs to: x-conversation-id, or x-execution-id for a playbook run with no
# conversation. Resolved in that order by the middleware because the sandbox MCP
# resolves it the same way — the two must agree or a downloaded file lands in a
# folder the sandbox never mounts. See RUN_STORAGE_CONTRACT.md.
_request_user_id: ContextVar[str | None] = ContextVar("_request_user_id", default=None)
_request_conversation_id: ContextVar[str | None] = ContextVar(
    "_request_conversation_id", default=None
)

# The acting user's delegated Microsoft Graph token, delivered per request by the
# connector auth layer in the configured token header (ADR-0017 provider
# authority). Set and reset by AuthMiddleware; never logged and never forwarded
# anywhere but Graph. There is deliberately no environment fallback: an ambient
# tenant token would let an unauthenticated caller inherit tenant authority.
_delegated_provider_token: ContextVar[str | None] = ContextVar(
    "_delegated_provider_token", default=None
)


def get_request_user_id() -> str | None:
    return _request_user_id.get()


def get_request_conversation_id() -> str | None:
    return _request_conversation_id.get()


def get_request_provider_token() -> str | None:
    return _delegated_provider_token.get()


def system_workspace_prefix() -> str:
    """The Ceph folder for this run: `<user_id>/system_<run_id>`.

    Same convention the sandbox MCP uses for its own files, so anything written
    here is visible to the sandbox once that path is mounted. Empty string when
    either id is missing — the caller must refuse rather than write to a
    half-formed path.
    """
    user_id = get_request_user_id()
    conversation_id = get_request_conversation_id()
    if not user_id or not conversation_id:
        return ""
    return f"{user_id}/system_{conversation_id}"

TEXT_EXTENSIONS = frozenset(
    {
        "txt",
        "md",
        "markdown",
        "json",
        "csv",
        "tsv",
        "xml",
        "html",
        "htm",
        "xhtml",
        "yaml",
        "yml",
        "toml",
        "ini",
        "cfg",
        "conf",
        "properties",
        "env",
        "log",
        "py",
        "pyw",
        "js",
        "mjs",
        "cjs",
        "ts",
        "tsx",
        "jsx",
        "css",
        "scss",
        "less",
        "sass",
        "sql",
        "sh",
        "bash",
        "zsh",
        "fish",
        "bat",
        "ps1",
        "cmd",
        "rb",
        "go",
        "rs",
        "java",
        "kt",
        "kts",
        "scala",
        "groovy",
        "c",
        "h",
        "cpp",
        "hpp",
        "cc",
        "cxx",
        "cs",
        "fs",
        "fsx",
        "vb",
        "php",
        "phtml",
        "swift",
        "dart",
        "r",
        "m",
        "lua",
        "pl",
        "pm",
        "ex",
        "exs",
        "erl",
        "hrl",
        "clj",
        "cljs",
        "hs",
        "ml",
        "vue",
        "svelte",
        "astro",
        "graphql",
        "gql",
        "tf",
        "hcl",
        "proto",
        "dockerfile",
        "makefile",
        "gitignore",
        "editorconfig",
        "rtf",
    }
)

_TEXT_MIME_PREFIXES = (
    "text/",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-yaml",
    "application/yaml",
    "application/toml",
    "application/x-www-form-urlencoded",
    "application/manifest+json",
    "application/ld+json",
    "application/problem+json",
    "application/rdf+xml",
    "application/xhtml+xml",
)

MAX_INLINE_TEXT_SIZE = 512_000

DRIVE_ITEM_SELECT = (
    "id,name,file,folder,webUrl,size,lastModifiedDateTime,"
    "createdDateTime,parentReference,sharepointIds"
)


def get_access_token() -> str:
    """The acting user's delegated Graph token for the current request.

    Provider authority is the verified user's own Microsoft connection, resolved
    by the connector auth layer per call; the MCP holds no tenant-wide Graph
    credential. Missing/expired user tokens fail closed here rather than falling
    back to a shared identity.
    """
    token = get_request_provider_token()
    if not token:
        raise RuntimeError(
            "No delegated Microsoft Graph token for this request. "
            "The connector must send the acting user's token in the configured "
            "provider-token header."
        )
    return token


def graph_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_access_token()}",
        "Content-Type": "application/json",
    }


def is_text_content(mime_type: str | None, filename: str | None) -> bool:
    if mime_type:
        lower = mime_type.lower()
        if any(lower.startswith(p) for p in _TEXT_MIME_PREFIXES):
            return True
        if lower != "application/octet-stream":
            return False
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
        return ext in TEXT_EXTENSIONS
    return False


def normalize_drive_item(
    raw: dict[str, Any], drive_id: str | None = None
) -> dict[str, Any]:
    parent_ref = raw.get("parentReference") or {}
    site_id = parent_ref.get("siteId") or (raw.get("sharepointIds") or {}).get("siteId")
    sharepoint_ids = raw.get("sharepointIds") or {}
    file_info = raw.get("file") or {}
    return {
        "siteId": site_id,
        "driveId": drive_id or parent_ref.get("driveId", ""),
        "itemId": raw.get("id", ""),
        "name": raw.get("name", ""),
        "webUrl": raw.get("webUrl", ""),
        "listItemUniqueId": sharepoint_ids.get("listItemUniqueId", ""),
        "listId": sharepoint_ids.get("listId", ""),
        "siteUrl": parent_ref.get("siteUrl", ""),
        "mimeType": file_info.get("mimeType", ""),
        "size": raw.get("size", 0),
        "isFolder": "folder" in raw,
        "lastModifiedDateTime": raw.get("lastModifiedDateTime", ""),
        "createdDateTime": raw.get("createdDateTime", ""),
    }


def normalize_drive(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "driveId": raw.get("id", ""),
        "name": raw.get("name", ""),
        "driveType": raw.get("driveType", ""),
        "webUrl": raw.get("webUrl", ""),
        "createdDateTime": raw.get("createdDateTime", ""),
        "owner": (raw.get("owner") or {}).get("user", {}).get("displayName", ""),
    }


def normalize_site(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "siteId": raw.get("id", ""),
        "displayName": raw.get("displayName", ""),
        "name": raw.get("name", ""),
        "webUrl": raw.get("webUrl", ""),
    }


def error_response(
    message: str, status_code: int | None = None, details: str | None = None
) -> str:
    payload: dict[str, Any] = {"status": "error", "message": message}
    if status_code:
        payload["statusCode"] = status_code
    if details:
        payload["details"] = details
    return json.dumps(payload, indent=2)


def success_response(data: Any) -> str:
    return json.dumps({"status": "success", **data}, indent=2)


def build_item_ref(
    drive_id: str, item_id: str | None = None, path: str | None = None
) -> str:
    if item_id:
        return f"/drives/{drive_id}/items/{item_id}"
    if path:
        encoded = quote(path.strip("/"))
        return f"/drives/{drive_id}/root:/{encoded}"
    return f"/drives/{drive_id}/root"


async def graph_get(
    path: str,
    headers: dict[str, str],
    params: dict[str, Any] | None = None,
    timeout: float = 30.0,
    follow_redirects: bool = False,
) -> tuple[Any, int, str]:
    async with httpx.AsyncClient(
        follow_redirects=follow_redirects, timeout=timeout
    ) as client:
        resp = await client.get(
            f"{GRAPH_BASE}{path}",
            headers=headers,
            params=params,
        )
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct:
            return resp.json(), resp.status_code, ct
        return resp.content, resp.status_code, ct


async def graph_post(
    path: str,
    headers: dict[str, str],
    json_body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> tuple[Any, int]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"{GRAPH_BASE}{path}",
            headers=headers,
            json=json_body,
        )
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct and resp.content:
            return resp.json(), resp.status_code
        return None, resp.status_code


async def graph_patch(
    path: str,
    headers: dict[str, str],
    json_body: dict[str, Any],
    timeout: float = 30.0,
) -> tuple[Any, int]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.patch(
            f"{GRAPH_BASE}{path}",
            headers=headers,
            json=json_body,
        )
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct and resp.content:
            return resp.json(), resp.status_code
        return None, resp.status_code


async def graph_delete(
    path: str,
    headers: dict[str, str],
    timeout: float = 30.0,
) -> int:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.delete(f"{GRAPH_BASE}{path}", headers=headers)
        return resp.status_code


async def graph_put_content(
    path: str,
    headers: dict[str, str],
    content: bytes,
    content_type: str = "text/plain",
    timeout: float = 60.0,
) -> tuple[Any, int]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.put(
            f"{GRAPH_BASE}{path}",
            headers={**headers, "Content-Type": content_type},
            content=content,
        )
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct and resp.content:
            return resp.json(), resp.status_code
        return None, resp.status_code


# ---------------------------------------------------------------------------
# Run storage (Ceph) — see RUN_STORAGE_CONTRACT.md
# ---------------------------------------------------------------------------

# A recursive folder download can walk an arbitrarily large SharePoint tree, so
# both are capped: the tool reports what it left behind rather than silently
# streaming gigabytes into Ceph and blocking for minutes. Env-tunable.
MAX_DOWNLOAD_FILES = int(os.getenv("MAX_DOWNLOAD_FILES", "200"))
MAX_DOWNLOAD_BYTES = int(os.getenv("MAX_DOWNLOAD_BYTES", str(512 * 1024 * 1024)))


class DownloadError(RuntimeError):
    """A document the caller asked for cannot be downloaded as given."""


def safe_relative_path(*segments: str) -> str:
    """Join name segments into a storage-safe relative path.

    Names come from SharePoint, not from us: a segment containing "/" or ".."
    would otherwise escape the run folder and write somewhere else in the bucket.
    Each segment is reduced to its own basename and stripped of traversal.
    """
    cleaned: list[str] = []
    for segment in segments:
        for part in str(segment or "").replace("\\", "/").split("/"):
            part = part.strip()
            if not part or part in (".", ".."):
                continue
            cleaned.append(part)
    return "/".join(cleaned)


def dedupe_relative_path(relative_path: str, taken: set[str]) -> str:
    """`relative_path`, suffixed if already used, so two same-named documents in
    one download cannot silently overwrite each other."""
    if relative_path not in taken:
        return relative_path
    head, _, tail = relative_path.rpartition("/")
    stem, dot, ext = tail.partition(".")
    for n in range(2, 1000):
        candidate = f"{stem} ({n}){dot}{ext}"
        if head:
            candidate = f"{head}/{candidate}"
        if candidate not in taken:
            return candidate
    raise DownloadError(f"too many name collisions for {relative_path}")


def _storage_client():
    """Lazy S3/Ceph client, or None if storage is not configured — so the module
    imports without boto3 and the error only surfaces when a download is asked for.

    Env names match the backend's Ceph config (CEPH_S3_*). Ceph/radosgw needs
    path-style addressing, hence CEPH_S3_FORCE_PATH_STYLE."""
    endpoint = os.getenv("CEPH_S3_ENDPOINT")
    access = os.getenv("CEPH_S3_ACCESS_KEY_ID")
    secret = os.getenv("CEPH_S3_SECRET_ACCESS_KEY")
    if not (endpoint and access and secret):
        missing = [
            n
            for n, v in (
                ("CEPH_S3_ENDPOINT", endpoint),
                ("CEPH_S3_ACCESS_KEY_ID", access),
                ("CEPH_S3_SECRET_ACCESS_KEY", secret),
            )
            if not v
        ]
        logger.info("storage: not configured, missing env %s", missing)
        return None
    try:
        import boto3  # lazy: only needed when a download actually runs
        from botocore.config import Config
    except ImportError as exc:
        logger.info("storage: boto3 not installed in this image (%s)", exc)
        raise DownloadError("downloads need boto3 installed on this server") from exc

    force_path = os.getenv("CEPH_S3_FORCE_PATH_STYLE", "true").lower() == "true"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.getenv("CEPH_S3_REGION") or "us-east-1",
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        config=Config(s3={"addressing_style": "path"}) if force_path else None,
    )


def _require_storage() -> tuple[Any, str]:
    """The Ceph client and bucket, or DownloadError naming what is unconfigured."""
    client = _storage_client()
    bucket = os.getenv("CEPH_S3_BUCKET")
    if client is None or not bucket:
        logger.info("storage: unconfigured (client=%s, bucket=%r)", client is not None, bucket)
        raise DownloadError(
            "downloads need CEPH_S3_ENDPOINT / CEPH_S3_BUCKET / "
            "CEPH_S3_ACCESS_KEY_ID / CEPH_S3_SECRET_ACCESS_KEY configured on this server"
        )
    return client, bucket


def put_storage_object(storage_key: str, raw: bytes, content_type: str) -> None:
    """Write bytes to Ceph under `storage_key` (sync — call via asyncio.to_thread).

    The sandbox symlinks each mounted workspace to live Ceph, so an object written
    here appears inside an already-running sandbox without restarting it — provided
    the run's folder is one of its mounted workspace paths.
    """
    client, bucket = _require_storage()
    logger.info("storage: writing key=%r bytes=%d to bucket=%r", storage_key, len(raw), bucket)
    try:
        client.put_object(
            Bucket=bucket,
            Key=storage_key,
            Body=raw,
            ContentType=content_type or "application/octet-stream",
        )
    except Exception as exc:  # botocore ClientError, etc.
        logger.info("storage: put_object failed key=%r: %s", storage_key, exc)
        raise DownloadError(f"could not write to storage: {storage_key}: {exc}") from exc


def run_storage_key(value: str, folder: str) -> str:
    """The Ceph key for a file the model named, or "" when it is not this run's.

    `download_documents` hands the model two names for the same file — the
    `storage_key` and the mounted `sandbox_path` — so both are accepted. Anything
    outside `folder` is refused rather than resolved: the model chooses this
    string, and the run folder is the only prefix its own files can be under.
    """
    key = str(value or "").strip().lstrip("/")
    if key.startswith("mnt/workspace/"):
        # /mnt/workspace/system_<run>/x  ->  <user_id>/system_<run>/x
        key = f"{folder.split('/')[0]}/{key[len('mnt/workspace/'):]}"
    return key if folder and key.startswith(f"{folder}/") else ""


def stat_storage_object(storage_key: str) -> dict[str, Any] | None:
    """Size and content type of a stored object, or None when there is none."""
    client, bucket = _require_storage()
    try:
        head = client.head_object(Bucket=bucket, Key=storage_key)
    except Exception as exc:  # botocore ClientError for a missing key
        logger.info("storage: head_object miss key=%r: %s", storage_key, exc)
        return None
    return {
        "size": head.get("ContentLength"),
        "content_type": head.get("ContentType") or "application/octet-stream",
    }

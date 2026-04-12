"""Shared Microsoft Graph API helpers for M365 Document Connector."""

import json
import os
from contextvars import ContextVar
from typing import Any
from urllib.parse import quote

import httpx

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

_request_token: ContextVar[str | None] = ContextVar("_request_token", default=None)

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
    token = _request_token.get()
    if token:
        return token
    env_token = os.getenv("M365_ACCESS_TOKEN")
    if env_token:
        return env_token
    raise RuntimeError(
        "No access token available. "
        "Token must be injected via Authorization header or M365_ACCESS_TOKEN env var."
    )


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
    file_info = raw.get("file") or {}
    return {
        "siteId": site_id,
        "driveId": drive_id or parent_ref.get("driveId", ""),
        "itemId": raw.get("id", ""),
        "name": raw.get("name", ""),
        "webUrl": raw.get("webUrl", ""),
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

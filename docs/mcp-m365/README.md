# M365 MCP Server

> **Slug:** `mcp-m365` | **Status:** stable | **Last Updated:** 2026-04-14 23:00 UTC

## Purpose

MCP server providing tools for searching, browsing, reading, creating, updating, renaming, and deleting documents and folders across OneDrive and SharePoint via Microsoft Graph API.

## Scope

### Included
- Site and drive discovery
- Full-text and name-based document search
- Folder browsing with recursive children listing
- Document metadata retrieval with download URL support
- Text file content reading (inline)
- Binary/Office file download URL resolution
- Document, folder creation and renaming
- Document content update

### Excluded
- File upload from MCP (use platform transfer tools)
- Permissions and sharing management
- Version history

## Architecture

```
Agent / ADK Runtime
       |
       | MCP call (with OAuth bearer)
       v
  mcp-m365/server.py
       |
       | HTTP (httpx)
       v
  Microsoft Graph API v1.0
       |
       v
  OneDrive / SharePoint
```

Auth token injected via `Authorization` header on each MCP request. Stored in a context var, never persisted.

## Tools

### Discovery

| Tool | Description |
|------|-------------|
| `list_accessible_sites` | List SharePoint sites |
| `list_accessible_drives` | List drives (OneDrive + SharePoint libraries) |

### Search

| Tool | Description |
|------|-------------|
| `search_documents` | Full-text search across M365. Scopes: `me`, `drive`, `all` |
| `find_items_by_name` | Exact name search in OneDrive or specific drive |

### Browse

| Tool | Description |
|------|-------------|
| `list_folder_children` | List files and subfolders of a folder |

### Read

| Tool | Description |
|------|-------------|
| `get_item_metadata` | Get metadata, timestamps, parent path, and download URL for binary files |
| `get_document_content` | Read file content. Returns inline text for text files, download URL for binary files |

### Write

| Tool | Description |
|------|-------------|
| `create_folder` | Create a new folder |
| `create_document` | Create a text document with content |
| `update_document_content` | Replace entire file content |
| `rename_item` | Rename a file or folder |
| `delete_item` | Delete a file or folder |

## Item Reference Contract

All tools return items in a consistent shape:

```json
{
  "siteId": "ca2d2dd4-...",
  "driveId": "b!1C0tyneZGkCcNl...",
  "itemId": "01HUWYISPHRAY...",
  "name": "report.xlsx",
  "webUrl": "https://...",
  "listItemUniqueId": "...",
  "listId": "...",
  "siteUrl": "...",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "size": 34586,
  "isFolder": false,
  "lastModifiedDateTime": "2026-03-11T17:39:20Z",
  "createdDateTime": "2026-01-06T16:57:48Z"
}
```

### Richer stable identifiers

Each item now includes fields beyond `driveId`/`itemId` to support stable cross-reference and backend recovery:

- `siteId` - SharePoint site ID
- `webUrl` - Direct URL to the item
- `listItemUniqueId` - SharePoint list item unique ID
- `listId` - SharePoint list ID
- `siteUrl` - Site URL from parent reference

These fields help prevent ID-mixing errors when the LLM reconstructs item references across search results.

## Agent Workflow Guidance

The tool docstrings guide agents through a consistent search-then-import workflow:

1. Use `search_documents` or `find_items_by_name` to discover files
2. Use `get_document_content` to read text files inline or get download URLs for binary files
3. Use `get_item_metadata` for property inspection (size, timestamps, parent path)
4. Pass the **full returned item object** to the connector import tool for workspace persistence

### Key behavioral notes

- `get_document_content` is the primary content access tool
- `get_item_metadata` now also returns `downloadUrl` for binary files when available
- For binary/Office files, `get_document_content` returns `contentMode: "download_url"` with a short-lived URL
- Agents should use the full item object as-is when passing to downstream tools
- Agents should NOT manually mix `driveId` from one result with `itemId` from another result

## Related Features

- [`connectors`](/docs/connectors/README_2026-04-14_23-00-00.md) - Connector catalog and workspace import flow

# Import To Workspace Tool

> **Slug:** `import-to-workspace` | **Status:** stable | **Last Updated:** 2026-04-14 23:20 UTC

## Purpose

Provide a single agent-facing tool that persists connector-discovered files into the platform workspace document system so downstream tools, especially code interpreter, can consume them through the existing workspace context flow.

This tool replaces the earlier `workspacebridge_import_connector_item_to_workspace` direction with a simpler REST-backed import path.

## Scope

### Included
- Auto-generated `<connector>_import_to_workspace` tool from connector bindings
- Available in both playbook and conversation ADK paths
- Single file, multi-file, and folder import modes
- Flattened folder imports for phase 1
- Platform JWT auth for NestJS import endpoint
- Workspace document persistence and collision-safe filenames
- Input coercion from multiple LLM-friendly shapes

### Excluded
- Exact folder hierarchy preservation in workspace/code interpreter mount
- Async import jobs for large folders
- Non-M365 connector-specific transfer adapters beyond the current registry

## Architecture

```
Agent
  |
  | 1. search/browse via connector MCP tools
  v
MCP result item object
  |
  | 2. call <connector>_import_to_workspace
  v
ADK import helper
  |
  | 3. POST /api/v1/connectors/transfer/import
  v
NestJS ConnectorTransferService
  |
  | 4. adapter resolves candidates + downloads files
  v
WorkspaceDocumentService
  |
  | 5. persist as workspace documents
  v
workspace_context / code interpreter
```

## Runtime Locations

### Playbook path
- `yellowstorm-adk/src/langgraph_engine/playbook_tool_factory.py`
- `_create_connector_import_tool()` creates the structured tool

### Conversation path
- `yellowstorm-adk/src/smart_rag/tools/utilities/connector_tools.py`
- `create_connector_tools()` adds the import tool when a connector binding and workspace are available

### Backend endpoint
- `YellowStorm/back/src/modules/connector/connector.controller.ts`
- `POST /api/v1/connectors/transfer/import`

### Backend transfer service
- `YellowStorm/back/src/modules/connector/connector-transfer.service.ts`

## Tool Contract

### Tool name

Generated dynamically from connector slug/name:

```text
<connector-slug>_import_to_workspace
```

Example:

```text
mcpsharepoint_import_to_workspace
```

### Supported modes

- `file`
- `files`
- `folder`

### Accepted input forms

The tool accepts several forms so the LLM does not have to normalize references manually.

#### 1. Direct drive/item arguments

```json
{
  "mode": "file",
  "drive_id": "b!...",
  "item_id": "01..."
}
```

#### 2. Direct item reference

```json
{
  "mode": "file",
  "item_ref": {
    "driveId": "b!...",
    "itemId": "01..."
  }
}
```

#### 3. Full MCP item object

```json
{
  "mode": "file",
  "item_ref": {
    "item": {
      "driveId": "b!...",
      "itemId": "01...",
      "siteId": "...",
      "webUrl": "https://..."
    }
  }
}
```

#### 4. Path-based reference

```json
{
  "mode": "file",
  "drive_id": "b!...",
  "path": "Folder/File.xlsx"
}
```

#### 5. Batch import

```json
{
  "mode": "files",
  "item_refs": [
    { "driveId": "b!...", "itemId": "01..." },
    { "driveId": "b!...", "itemId": "02..." }
  ]
}
```

#### 6. Folder import

```json
{
  "mode": "folder",
  "item_ref": {
    "driveId": "b!...",
    "itemId": "01-folder..."
  },
  "recursive": true
}
```

## Input Coercion Rules

The ADK helper attempts to coerce the provided value into a valid import reference.

It supports:
- raw dicts with `driveId` + `itemId` or `path`
- nested dicts under `item`, `data`, or `result`
- JSON strings containing any of the above
- deeper nested dict values that contain `driveId` and `itemId`

Preserved fields when present:
- `driveId`
- `itemId`
- `path`
- `siteId`
- `webUrl`
- `listItemUniqueId`
- `listId`
- `siteUrl`

These richer fields exist to reduce failures when the LLM passes full MCP items and to support future backend recovery logic.

## Auth Model

The tool must authenticate to NestJS, not to Microsoft Graph.

### Important separation

- Connector OAuth bearer:
  Used by MCP tools to call SharePoint/Microsoft Graph
- Platform JWT bearer:
  Used by `import_to_workspace` to call NestJS `JwtAuthGuard`

### ADK config

Required environment variables:

| Variable | Purpose |
|----------|---------|
| `API_URL` | NestJS backend base URL |
| `NESTJS_JWT_SECRET` | Must match backend `JWT_SECRET` |
| `AUTH_USERNAME` | Must be a valid backend user `_id` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT expiry for generated platform tokens |

### JWT claims used

```json
{
  "sub": "<valid backend user id>",
  "type": "access",
  "iss": "yellostorm",
  "aud": "yellostorm-api"
}
```

## Workspace Selection

The tool must target a real persisted workspace.

### Current behavior

The ADK prefers:
1. `brain_documents[].workspace_id`
2. fallback `conversation_brain_id`

This avoids using transient brain identifiers that do not exist as backend workspaces.

## Backend Import Contract

The ADK helper calls:

```text
POST /api/v1/connectors/transfer/import
```

with:

```json
{
  "connectorId": "...",
  "workspaceId": "...",
  "mode": "file|files|folder",
  "itemRef": { ... },
  "itemRefs": [ ... ],
  "recursive": true,
  "flatten": true
}
```

The helper reads the actual backend result from the wrapped `data` field returned by NestJS.

## Success Response Shape

Rendered back to the LLM as a plain-text summary, for example:

```text
Imported connector items from MCP Sharepoint into workspace <workspace-id>.

Requested: 1, imported: 1, failed: 0.

Imported items:
- report.xlsx -> workspaceDocumentId=<doc-id>
```

## Failure Modes

### Common failures

- `Unauthorized`
  Cause: wrong JWT secret, wrong JWT claims, or invalid `AUTH_USERNAME`

- `Workspace not found`
  Cause: transient workspace/brain ID used instead of persisted workspace ID

- `No transfer adapter registered`
  Cause: connector slug not mapped to an adapter in backend registry

- `Failed to fetch item metadata: 404 itemNotFound`
  Cause: mismatched `driveId` and `itemId` from different search results

### LLM guidance

Agents should:
1. search first
2. use the returned full item object as-is
3. call `import_to_workspace`
4. avoid reconstructing the item reference manually when possible

## Phase 1 Limitations

- Folder imports are flattened
- Folder hierarchy is not preserved in code interpreter mount
- Import is synchronous
- Large-file handling still follows current workspace upload constraints

## Related Features

- [`connectors`](/docs/connectors/README_2026-04-14_23-00-00.md)
- [`mcp-m365`](/docs/mcp-m365/README.md)

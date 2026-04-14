---
name: m365-document-workflows
description: Use for SharePoint and OneDrive document workflows where the agent must search, read, import into workspace, and then hand files off to code interpreter or other downstream tools.
license: Apache-2.0
---

# M365 Document Workflows

Use this skill when the task involves SharePoint or OneDrive documents and the file may need to be processed further by code interpreter.

This skill is specifically for the document-oriented M365 tool flow:

1. discover the exact file or folder
2. inspect content with the correct MCP tool
3. import the file(s) into workspace when downstream processing is needed
4. use code interpreter on the persisted workspace documents

## When To Use This Skill

Use this skill when the user asks to:

- find a document in SharePoint or OneDrive
- open or read a document
- download a document
- analyze an Excel, Word, PDF, CSV, or other office file
- process a SharePoint file with code interpreter
- import one file, several files, or a folder into the current workspace

## Core Workflow

Follow this sequence.

### 1. Discover the exact item

Use one of these tools first:

- `search_documents`
- `find_items_by_name`
- `list_folder_children`
- `list_accessible_sites`
- `list_accessible_drives`

Goal:
- identify the exact returned item object that corresponds to the user’s target file or folder

### 2. Decide whether you need content or only metadata

Use this decision rule:

- If the user wants to read, open, inspect actual content, download, or process the file: use `get_document_content`
- If the user only needs properties like size, timestamps, or parent path: use `get_item_metadata`

Important:
- `get_document_content` is the primary content-access tool
- `get_item_metadata` is secondary and should not be the first tool when the real goal is content access

### 3. If downstream processing is needed, import into workspace

If the file must be processed by code interpreter or another workspace-based tool, call:

```text
<connector-slug>_import_to_workspace
```

Example:

```text
mcpsharepoint_import_to_workspace
```

### 4. Use code interpreter on the workspace documents

Once imported, the file becomes a standard workspace document.

That means:
- the workspace context can expose it to downstream tools
- code interpreter should work against the workspace-persisted file, not the raw connector reference

## Tool Order

### Preferred order for text files

1. `search_documents` or `find_items_by_name`
2. `get_document_content`
3. if further processing is needed, `*_import_to_workspace`
4. code interpreter

### Preferred order for binary or Office files

1. `search_documents` or `find_items_by_name`
2. `get_document_content`
3. `*_import_to_workspace`
4. code interpreter

### Preferred order for folder ingestion

1. `list_folder_children` or `search_documents`
2. identify the exact folder item object
3. `*_import_to_workspace` with `mode: folder`
4. code interpreter on imported files

## Exact Item Selection Rules

These rules are mandatory.

### Always use one exact returned item object

When a search or browse tool returns results:

- select one concrete returned item object
- pass that exact object forward when possible

### Do not reconstruct IDs manually unless necessary

Avoid building references manually from memory when you already have the full returned item object.

Bad pattern:
- `driveId` from one result
- `itemId` from another result

This causes Graph 404 errors like:

```text
itemNotFound
```

### Prefer passing the full item object

The import tool can accept:

- direct `drive_id` / `item_id`
- direct `item_ref`
- a full MCP result item object
- path-based references

Best practice:
- pass the full MCP item object as-is whenever available

## Content Vs Metadata Rules

### Use `get_document_content` when:

- the user says “read”, “open”, “download”, “show me the file”, or “analyze this file”
- you need inline text for a text file
- you need a download URL for a binary file
- you need to prepare a file for import and downstream processing

### Use `get_item_metadata` when:

- the user wants file properties
- you need timestamps, size, MIME type, or parent path
- you need supplementary inspection after discovery

Do not start with metadata if the actual goal is file processing.

## Import To Workspace Tool

### Purpose

`<connector>_import_to_workspace` persists connector-discovered files into the platform workspace document system.

This is the correct path when files must later be processed by code interpreter.

### Supported modes

- `file`
- `files`
- `folder`

### Accepted input forms

#### Direct drive and item

```json
{
  "mode": "file",
  "drive_id": "b!...",
  "item_id": "01..."
}
```

#### Direct item_ref

```json
{
  "mode": "file",
  "item_ref": {
    "driveId": "b!...",
    "itemId": "01..."
  }
}
```

#### Full MCP item object

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

#### Folder import

```json
{
  "mode": "folder",
  "item_ref": {
    "item": {
      "driveId": "b!...",
      "itemId": "01-folder..."
    }
  },
  "recursive": true
}
```

### Current phase-1 behavior

- folder imports are flattened
- hierarchy is not preserved in the workspace/code interpreter mount yet
- import is synchronous

## Auth Separation

Keep these two auth paths separate.

### Connector OAuth

Used by M365 MCP tools to call Microsoft Graph.

Examples:
- `search_documents`
- `get_document_content`
- `get_item_metadata`

### Platform JWT

Used by `*_import_to_workspace` to call NestJS:

```text
POST /api/v1/connectors/transfer/import
```

Do not assume connector OAuth can be reused for backend import auth.

## Workspace Targeting Rules

The import tool must target a real persisted workspace.

Prefer:

1. `brain_documents[].workspace_id`
2. fallback `conversation_brain_id`

Do not rely on transient brain identifiers if a real workspace ID is already available.

If no persisted workspace is available, stop and ask for a valid target instead of guessing.

## Failure Modes To Avoid

### 1. Mixed references

Do not mix:
- `driveId` from one result
- `itemId` from another result

Always keep item references atomic.

### 2. Wrong tool choice

Do not start with `get_item_metadata` when the user wants content or downstream processing.

Use `get_document_content` first.

### 3. Wrong auth assumption

Do not assume the connector OAuth token authenticates the backend import endpoint.

### 4. Wrong workspace target

Do not target transient or non-persisted workspace IDs when a persisted workspace exists in document context.

### 5. Manual reshaping when not needed

If a full MCP item object already exists, pass it through instead of rebuilding a smaller reference manually.

## Recommended Response Pattern

When working through this flow:

1. confirm the chosen exact file or folder
2. say whether you are reading inline content or importing into workspace
3. after import, refer to the resulting workspace document(s) as the source for code interpreter

Example:

```text
I found the exact Excel file in SharePoint. I’m importing it into the current workspace now so the code interpreter can process the persisted workspace document instead of the raw connector reference.
```

## Practical Rules Of Thumb

- Search first
- Choose one exact returned item
- Use `get_document_content` for content access
- Use `*_import_to_workspace` before code interpreter
- Must wait for the tool  `*_import_to_workspace` response before starting the use of the code interpreter tool
- Pass the full item object when possible
- Avoid manual ID recomposition

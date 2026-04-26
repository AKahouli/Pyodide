---
name: obsidian-context
description: >
  Search and update the project Obsidian vault for long-term agent memory: features, architecture, conventions, decisions, contracts, and recent changes. Must always use before coding and when maintainer needs to sync memory.
tools:
  - obsidian_obsidian_read_note
  - obsidian_obsidian_update_note
  - obsidian_obsidian_search_replace
  - obsidian_obsidian_global_search
  - obsidian_obsidian_list_notes
  - obsidian_obsidian_manage_frontmatter
  - obsidian_obsidian_manage_tags
  - obsidian_obsidian_delete_note
---

# Obsidian Vault Context

This skill gives agents **read/write access** to the project's Obsidian vault via `obsidian-mcp-server` (Local REST API bridge). The MCP server connects to the [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin at `http://127.0.0.1:27123`.

The Obsidian vault is the canonical long-term memory for OpenCode agents. Use it to retrieve high-signal context before coding and to preserve implementation knowledge after reviewed changes.

> **Agent Directive:** Prioritize useful vault connectivity. When writing or updating notes, create deliberate `[[Internal Links]]` and relevant `#tags` that help future agents find constraints quickly without link spam.

***

## Available MCP Tools

This server equips the agent with specialized tools to interact with the Obsidian vault. In this workspace, tool names are prefixed with `obsidian_obsidian_`.

| Tool | Action | Description | Key Features |
| :--- | :---: | :--- | :--- |
| `obsidian_obsidian_read_note` | **Fetch** | Retrieves the content and metadata of a specified note. | - Read in Markdown or JSON format.<br>- Case-insensitive path fallback.<br>- Includes file stats (creation/modification time). |
| `obsidian_obsidian_update_note` | **Write** | Modifies notes using whole-file operations. | - `append`, `prepend`, or `overwrite` content.<br>- Can create files if they don't exist.<br>- Targets files by path, active note, or periodic note. |
| `obsidian_obsidian_search_replace` | **Edit** | Performs search-and-replace operations within a target note. | - Supports string or regex search.<br>- Options for case sensitivity, whole word, and replacing all occurrences. |
| `obsidian_obsidian_global_search` | **Discover** | Performs a search across the entire vault. | - Text or regex search.<br>- Filter by path and modification date.<br>- Paginated results. |
| `obsidian_obsidian_list_notes` | **Explore** | Lists notes and subdirectories within a specified vault folder. | - Filter by file extension or name regex.<br>- Provides a formatted tree view of the directory. |
| `obsidian_obsidian_manage_frontmatter` | **Metadata** | Atomically manages a note's YAML frontmatter. | - `get`, `set`, or `delete` frontmatter keys.<br>- Avoids rewriting the entire file for metadata changes. |
| `obsidian_obsidian_manage_tags` | **Organize** | Adds, removes, and lists tags for a note. | - Manages tags in both YAML frontmatter and inline content. |
| `obsidian_obsidian_delete_note` | **Remove** | Permanently deletes a specified note from the vault. | - Case-insensitive path fallback for safety. |

***

## When to Use

### Before Modifying Code

When implementing a feature or fixing a bug, search the vault before inspecting code:

1. `obsidian_obsidian_global_search` — use task terms, feature slugs, module names, source paths, API names, and error text to find related notes.
2. `obsidian_obsidian_list_notes` — list `YellowStorm/` when the vault structure or index notes are unclear.
3. `obsidian_obsidian_read_note` — read relevant feature, architecture, decision, convention, contract, and timeline notes. For feature notes, read `Agent Quick Context` first.
4. Follow only directly relevant `[[Internal Links]]` from those notes, such as related architecture, contracts, decisions, conventions, or pitfalls.
5. Respect documented constraints and patterns before writing or changing code.
6. Inspect the codebase after memory retrieval because code remains the final factual source.

### After Completing a Task *(Maintainer Agent)*

When the maintainer agent is syncing memory:

1. `obsidian_obsidian_global_search` — check for existing notes on the feature slug.
2. If notes **exist** → `obsidian_obsidian_update_note` to append or overwrite with the latest changes.
3. If **no notes exist** → `obsidian_obsidian_update_note` (with create) to capture feature behavior, architecture decisions, API contracts, known pitfalls, or patterns worth preserving.
4. `obsidian_obsidian_manage_tags` — tag notes with the feature slug and relevant cross-references.
5. `obsidian_obsidian_manage_frontmatter` — set or update YAML metadata (`status`, `updated`, `owner`, `source_paths`, etc.) without rewriting the whole file.
6. For Full-tier notes, add or verify `Agent Quick Context` and 3-7 high-value `[[Internal Links]]` to related architecture, contracts, decisions, conventions, features, or pitfalls.

### During Architecture Discovery

When exploring an unfamiliar part of the codebase:

1. `obsidian_obsidian_list_notes` — confirm vault structure and available folders.
2. `obsidian_obsidian_global_search` — search for architectural concepts, module names, or feature slugs.
3. `obsidian_obsidian_read_note` — read any vault-index or MOC (Map of Content) notes first to orient navigation.

***

## Project Vault Convention

Use this structure for YellowStorm memory:

```text
YellowStorm/
├── Index.md
├── Features/
│   └── {feature_slug}.md
├── Architecture/
│   └── {topic}.md
├── Decisions/
│   └── ADR-{number}-{topic}.md
├── Conventions/
│   └── {topic}.md
└── Timeline/
    └── YYYY-MM.md
```

Prefer stable feature notes at `YellowStorm/Features/{feature_slug}.md`. Use architecture notes for cross-cutting design, decision notes for durable ADR-style decisions, convention notes for coding/workflow rules, and timeline notes for recent change routing.

### Feature Note Frontmatter

```yaml
---
project: YellowStorm
type: feature
slug: {feature_slug}
status: active
updated: YYYY-MM-DD HH:MM UTC
source_paths:
  - YellowStorm/front/src/modules/{module}
  - YellowStorm/back/src/modules/{module}
tags:
  - yellowstorm
  - feature/{feature_slug}
---
```

### Retrieval Heuristics

- Search by user task terms first, then by likely feature slug, module folder, class/function names, endpoint paths, proto/service names, and error messages.
- Prefer notes with matching `source_paths`, `slug`, or `feature/{slug}` tags.
- Read `Agent Quick Context` first when a note has it.
- Follow only directly relevant `[[Internal Links]]`; do not recursively traverse broad note graphs unless the task is architectural.
- Read `YellowStorm/Index.md` or other MOC/index notes when search results are broad.
- Read only the notes needed for the task, but include at least one feature or architecture note when available.

### Precision Edits

When a small, targeted change is needed within an existing note (e.g., updating a version number, fixing a broken link):

1. `obsidian_obsidian_read_note` — confirm current content before editing.
2. `obsidian_obsidian_search_replace` — apply a precise string or regex replacement without touching the rest of the file.

***

## Tool Usage Patterns

### Reading a Note

```text
obsidian_obsidian_read_note
  filePath: "YellowStorm/Architecture/backend-nestjs.md"
  format: "markdown"
  includeStat: true
```

### Appending to an Existing Note

```text
obsidian_obsidian_update_note
  targetType: "filePath"
  targetIdentifier: "YellowStorm/Features/auth.md"
  content: "\n## Recent Changes\n### 2026-04-26 00:00 UTC\n- Changed: Added PKCE support for public clients.\n- Related: [[Security PKCE Flow]]"
  modificationType: "wholeFile"
  wholeFileMode: "append"
  createIfNeeded: true
```

### Global Search with Filters

```text
obsidian_obsidian_global_search
  query: "rate limiting"
  searchInPath: "YellowStorm/Architecture"
  modified_since: "2026-01-01"
```

### Atomic Frontmatter Update

```text
obsidian_obsidian_manage_frontmatter
  filePath: "YellowStorm/Features/auth.md"
  operation: "set"
  key: "status"
  value: "implemented"
```

### Regex Search-and-Replace

```text
obsidian_obsidian_search_replace
  targetType: "filePath"
  targetIdentifier: "YellowStorm/Architecture/user-service-contract.md"
  replacements:
    - search: "v1\\.(\d+)"
      replace: "v2.$1"
  useRegex: true
  replaceAll: true
  caseSensitive: true
```

***

## Vault Access

The vault is accessed through the **Obsidian Local REST API** plugin:

| Parameter | Value |
| :--- | :--- |
| **Base URL** | `http://127.0.0.1:27123` |
| **Transport** | HTTP (via `obsidian-mcp-server` npx package) |
| **Requirement** | Obsidian must be running with the Local REST API plugin enabled |
| **Vault path** | `C:\Users\agara\Documents\my2nd\my2nd` |

> The vault filesystem path above is for direct file operations only. All agent interactions must go through the MCP tools — never bypass the API layer for vault reads/writes.

***

***

## Best Practices

- **Always search before writing.** Run `obsidian_obsidian_global_search` or `obsidian_obsidian_list_notes` before creating a new note to avoid duplicates.
- **Prefer `append` over `overwrite`.** When adding new information, use `append` to preserve existing content and history.
- **Use `obsidian_obsidian_search_replace` for targeted edits.** Avoid overwriting entire notes when only a small section needs to change.
- **Keep frontmatter consistent.** Use `obsidian_obsidian_manage_frontmatter` to enforce schema fields (`status`, `source_paths`, `tags`, `updated`, `owner`) across all notes.
- **Link deliberately.** Full-tier notes should have 3-7 high-value `[[Internal Links]]` to related architecture, contracts, decisions, conventions, features, or pitfalls.
- **Prefer useful next reads.** Each link should help a future agent avoid a bad change or find the next relevant constraint quickly.
- **Tag at creation time.** Apply `#tags` when creating notes — retrofitting tags is costly and often skipped.
- **Delete with care.** `obsidian_obsidian_delete_note` is permanent. If a note should be retained, mark it deprecated in frontmatter and add an explanation instead of deleting it.

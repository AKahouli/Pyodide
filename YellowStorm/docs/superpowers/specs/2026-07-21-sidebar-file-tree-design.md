# Collection sidebar — rebuild the hierarchy on the file-tree component — Design

**Status:** Approved (brainstorming complete) — ready for implementation planning.

## Problem

`CollectionSidebar`'s hierarchy is a hand-rolled recursive `TrieRows` renderer — visually rough. We now have the AI Elements `file-tree` component (`front/src/components/ai-elements/file-tree.tsx`) which gives a clean, consistent tree layout (indentation, connector lines, chevrons, hover). We want the sidebar hierarchy rendered with it, all nodes showing a link icon.

## Goal

Render the collection hierarchy with the `file-tree` primitives, preserving every per-node control, with a `Link2` icon on all nodes — a nicer hierarchy display with no loss of functionality.

## Locked Decisions (from brainstorming)

1. **Reuse the installed `file-tree` component** (`FileTree` / `FileTreeFolder` / `FileTreeFile` / `FileTreeActions`) for the hierarchy. It's copied into our repo, so we adapt it as needed.
2. **All nodes use the `Link2` (chain-link) icon.**
3. **Preserve all per-node controls**: selection `Checkbox` (disabled when already-indexed), `IndexingStatusDot`, display name + URL subtitle + "Déjà indexée", Explore button (`Compass`/`Loader2`), edit pencil (`EditLeafPopover`), delete (`Trash2`), and the pinned `AddLinkRow`.
4. **`CollectionSidebar`'s public props are unchanged** — only its internal rendering changes, so `AddLinkDialog` is unaffected.

## Architecture

### `file-tree.tsx` — minimal edits (it's ours now)
`FileTreeFolder` currently renders a fixed header row: `[chevron trigger][folder icon + name]`. Extend it with three optional props so it can show a link icon and carry a dual-node's controls:
- `icon?: ReactNode` — overrides the default folder icon (we pass `<Link2/>`).
- `leading?: ReactNode` — rendered right after the chevron, before the name (for a dual node's `IndexingStatusDot` + `Checkbox`).
- `actions?: ReactNode` — rendered trailing (`ml-auto`, stop-propagation, like `FileTreeActions`) for a dual node's Explore/edit/delete.
- Add an `aria-label` to the chevron trigger: `` `${isExpanded ? 'collapse' : 'expand'} ${name}` `` (preserves the existing collapse/expand test's accessible name).

`FileTreeFile` already accepts `icon` and full `children` override — no edit needed.

### `CollectionSidebar.tsx` — swap `TrieRows` internals for file-tree
- **Keep** `buildTrie`, the `TrieNode` interface, `AddLinkRow`, `EditLeafPopover`, and all props. Remove the hand-rolled `collapsed` Set / `onToggleCollapse` and the `<li>`/`ChevronRight` markup.
- **Expand state**: use `<FileTree expanded={expanded} onExpandedChange={setExpanded}>` with a local `expanded: Set<string>` keyed by node path. Default: all expanded (match current default-open behavior). The node `path` is the same stable key `TrieRows` builds (`${parentKey}/${segment}`).
- **Recursive render** of `TrieNode`s:
  - **Category (children, no `url`)** → `<FileTreeFolder path name={segment} icon={<Link2/>}>{recurse(children)}</FileTreeFolder>`.
  - **Leaf (`url`, no children)** → `<FileTreeFile path name={displayName} icon={<Link2/>}>` with `children` = a custom row: `IndexingStatusDot` (if status) + `Checkbox` (aria-label `displayName`, `disabled` when already-indexed) + a name/URL block (name, url subtitle, "Déjà indexée") + `<FileTreeActions>` holding Explore + `EditLeafPopover` + delete. (Selection stays our multi-select `Checkbox`; the tree's single-select `onSelect` is unused.)
  - **Dual (`url` + children)** → `<FileTreeFolder path name={displayName} icon={<Link2/>} leading={<>{status}{checkbox}</>} actions={<>{explore}{edit}{delete}</>}>{recurse(children)}</FileTreeFolder>`.
- The `AddLinkRow` renders above the `<FileTree>`; the empty state ("Naviguez pour collecter des pages.") is preserved.
- **Preserve accessible names** so existing tests keep passing: checkbox `aria-label={displayName}`, delete `aria-label={`delete ${url}`}`, explore `aria-label={`explore ${url}`}`, edit `aria-label={`edit ${url}`}`, `IndexingStatusDot` (`role=img`), category name text, and the folder chevron `aria-label` above.

## Edge Cases

- **Collapse hides children**: `file-tree` uses Radix `Collapsible`, which keeps closed content mounted-but-`hidden` (vs the old conditional unmount). The existing collapse test's `toBeNull()` assertion becomes `not.toBeVisible()`.
- **Dual node checkbox placement**: leading slot (before the name), matching leaves — consistent.
- **Selected/indexed/exploring state**: still driven by the same `Set<string>` props; nothing about selection semantics changes.
- **Other `file-tree` consumers**: none today, so the `FileTreeFolder` prop additions are additive and safe.

## Testing

- **`buildTrie` tests**: unchanged (data logic untouched).
- **Render tests**: unchanged where they key off preserved accessible names (checkbox by `displayName`, delete/explore by url, status `role=img`, category name text, add row, edit popover).
- **Collapse/expand test**: update the assertion from `toBeNull()` to `not.toBeVisible()` (Radix keeps the node mounted-hidden); the `getByLabelText('collapse a'/'expand a')` query still works via the chevron `aria-label` we add.
- **New**: a leaf renders a `Link2` icon (assert an icon/link glyph present per leaf) — light.

## Out of Scope

- Changing `CollectionSidebar`'s props / the `AddLinkDialog` integration.
- Migrating the other hand-rolled trees (`MoveFolderDialog`, `WorkspaceExplorerSidebar`) to file-tree.
- The tree's single-select `onSelect`/`selectedPath` behavior (we keep multi-select checkboxes).
- Overwriting the shared `collapsible.tsx` (kept as-is during install).

## Global Constraints

- TDD; conventional commits, **no `Co-Authored-By` trailer**; colocated tests.
- Keep `buildTrie`, `CollectionSidebar`'s props, `AddLinkRow`, and `EditLeafPopover` intact; only the hierarchy rendering changes.
- Preserve accessible names so behavior parity is provable by the existing tests (only the collapse visibility assertion changes).
- `file-tree.tsx` edits are additive (optional props) — no other consumer exists.

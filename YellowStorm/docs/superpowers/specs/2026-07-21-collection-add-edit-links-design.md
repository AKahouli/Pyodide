# Manually add & edit links in the browse collection — Design

**Status:** Approved (brainstorming complete) — ready for implementation planning.

## Problem

During a browse session (`AddLinkDialog`), the collection of pages to index is built **only** from what the user clicks to in the remote browser (`navigated` events). The user cannot (a) add a link by hand — e.g. a page on a different domain they can't reach by clicking — nor (b) fix a link that was collected with a wrong/ugly name or URL. The collection is capture-only and immutable until indexing.

## Goal

Let the user, mid-session, **manually add a link** (any domain) to the collection, and **edit the name or URL** of any actual page in the collection hierarchy — before indexing.

## Locked Decisions (from brainstorming)

1. **Manual add: inline add row** pinned at the top of `CollectionSidebar` (URL field + optional name + add button). Added links are auto-selected (via the existing new-page selection effect).
2. **Edit: pencil icon → popover.** Each editable leaf row gets a pencil icon (next to the trash icon) opening a small popover with Name + URL fields and Save/Cancel. Only actual page nodes (a `TrieNode` with a `url`) are editable — category-only path-segment nodes are not.
3. **Manual links stand on their own root.** When indexed, a manual link's `sourceRootUrl` is its **own URL** (so a different-domain link is not nested under the session's site). Navigated pages keep the session root.
4. **URL-keyed identity, coordinated edits.** Pages remain identified by URL (matching the existing selection/dedup/indexing contract). No stable per-page `id` is introduced. Editing a URL is a coordinated update (mutate the page + migrate its selection entry). **Duplicate URLs are rejected** on add and edit.
5. **Any domain allowed.** The only add/edit validation is a valid `http(s)` URL. No client-side SSRF/reachability check; the backend fetches the URL at index time exactly as it does today.

## Architecture & Data Flow

### Data model
`CollectedPage` gains one optional field:

```ts
export interface CollectedPage { url: string; title: string; linkText?: string; manual?: boolean; }
```

`manual: true` marks links the user typed in (drives self-rooting at index time). Navigated pages leave it unset.

### `useBrowserSession` — collection mutation (source of truth)
Pages already live here (`pages` + `seenRef` dedup). Add two callbacks and expose them:

- `addManualPage(url: string, name?: string): boolean`
  - Return `false` if `url` is not a valid http(s) URL, or `normalizeUrl(url)` is already in `seenRef` (duplicate).
  - Otherwise add `{ url: url.trim(), title: '', linkText: name?.trim() || undefined, manual: true }` to `pages`, add the normalized key to `seenRef`, return `true`.

- `updatePage(oldUrl: string, patch: { url?: string; name?: string }): boolean`
  - Find the page whose `url === oldUrl`; if none, return `false`.
  - If `patch.url` is provided and differs: return `false` if it is not a valid http(s) URL, or its normalized form belongs to a **different** existing page (collision). Otherwise migrate `seenRef` (remove old normalized key, add new) and set the page's `url`.
  - If `patch.name` is provided, set the page's `linkText` to the trimmed value (empty string clears it to `undefined`).
  - Return `true`.

Both operate on `setPages` immutably and keep `seenRef` consistent so a later `navigated` event can't re-add or collide.

### `CollectionSidebar` — add row + edit affordance
- **Add row** (pinned, above the trie list): a URL `Input`, an optional name `Input`, and an add button. On submit → `onAdd(url, name)`; the parent returns success/failure so the row can show inline "URL invalide" / "Déjà dans la liste" feedback and clear on success.
- **Pencil icon** on each leaf row (nodes with `node.url`), beside the existing trash icon → opens a popover (shadcn `Popover`) containing Name (defaulting to `node.label ?? ''`) and URL (defaulting to `node.url`) inputs + Annuler/Enregistrer. On save → `onEdit(node.url, { url, name })`; parent returns success so the popover can show a collision/invalid error or close on success.
- New props: `onAdd: (url: string, name?: string) => boolean` and `onEdit: (oldUrl: string, patch: { url?: string; name?: string }) => boolean`. Existing props unchanged.

### `AddLinkDialog` — wiring
- `onAdd = (url, name) => session.addManualPage(url, name)` (added page auto-selects via the existing `useEffect` on `session.pages`).
- `onEdit = (oldUrl, patch) => { const ok = session.updatePage(oldUrl, patch); if (ok && patch.url && patch.url !== oldUrl) migrate selected (delete oldUrl, add patch.url when it was selected); return ok; }`.
- Build a **`roots` map** in `handleIndex`, parallel to the existing `names` map: for each chosen page that is `manual`, `roots[page.url] = page.url`. Pass `roots` in the `addPageLinks` options (omit entries for navigated pages so the backend falls back to the session root).

### Frontend plumbing
- `api.ts` `addLinks` and `store.ts` `addPageLinks` options gain `roots?: Record<string, string>` (forwarded in the request body alongside `names`/`sourceRootUrl`).

### Backend — per-link root override
- `AddLinksDto` gains `@IsOptional() @IsObject() roots?: Record<string, string>`.
- `workspace-document.controller.ts` passes `roots: body.roots` into the service options.
- `workspace-document.service.ts` `addLinks` options gain `roots?: Record<string, string>`. Per URL, compute `const root = options?.roots?.[url] ?? options?.sourceRootUrl;` and use `root` (instead of `options.sourceRootUrl`) when writing `metadata.sourceRootUrl` + `metadata.normalizedSourceRootUrl`. When `root` is falsy, omit those metadata keys (as today).

## Edge Cases

- **Invalid URL** (non-http/https) on add/edit → rejected with inline feedback; the collection is unchanged.
- **Duplicate URL** on add, or **collision** on edit (new URL matches another page) → rejected; edit popover stays open with an error.
- **Name-only edit** → updates `linkText` → flows to the indexed document name via the existing `names` map.
- **Editing a navigated page's URL** → the page stays non-`manual`, so it keeps the session root at index time (only `manual` pages self-root). Its position in the trie updates to reflect the new URL.
- **Editing the URL of a selected page** → selection follows the page (migrated in `AddLinkDialog`).
- **`already indexed` badge** (`checkUrls`) continues to key off the normalized URL, so it re-evaluates naturally after an edit/add.
- **Manual link on an unreachable/blocked domain** → allowed into the collection; if conversion fails at index time the document lands in the existing `failed` state (unchanged backend behavior).

## Testing

**`useBrowserSession`:**
- `addManualPage` adds a page (`manual: true`); rejects a duplicate normalized URL; rejects an invalid URL.
- `updatePage` edits name and URL; rejects a URL collision with another page; leaves other pages untouched.

**`CollectionSidebar`:**
- The add row calls `onAdd` with the typed URL (+ name) and shows feedback when the parent returns `false`.
- A leaf's pencil opens the popover and Save calls `onEdit(oldUrl, { url, name })`.
- Category-only nodes render no pencil.

**`AddLinkDialog`:**
- Editing a selected page's URL migrates the selection (the new URL is selected, the old is not).
- `handleIndex` sends a `roots` map with each chosen manual link self-rooted and no entry for navigated pages.

**Backend:**
- `AddLinksDto.roots` accepts an object, rejects a non-object, allows omission.
- `addLinks` writes `metadata.sourceRootUrl` from `roots[url]` when present, else from `sourceRootUrl`; omits it when neither is set.

## Out of Scope (this iteration)

- Removing a page from the collection entirely (the existing trash icon continues to only deselect).
- Editing category (path-segment) nodes or bulk-editing.
- Reachability/SSRF validation of manually-added URLs at add time.
- Per-link overrides other than the source root (e.g. per-link deepSearch).
- Any stable-id refactor of the page identity model.

## Global Constraints

- TDD: failing test first, minimal implementation, then commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.spec.ts` backend, `X.test.ts(x)` frontend).
- URL-keyed identity preserved; duplicate URLs rejected; `seenRef` kept consistent on add/edit.
- Existing capture flow, selection contract, `names`/`sourceRootUrl` indexing, and manual-folder/viewport behavior are untouched except where this spec adds to them.

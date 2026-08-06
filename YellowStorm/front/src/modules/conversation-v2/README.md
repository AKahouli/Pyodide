# Conversation V2 — Frontend

Vue-free React module for Manus conversations: composer, streaming timeline,
right panel (tool details + **Nodepod app preview**), skills/connectors, deploy.

Related docs:

- [`SKILLS.md`](SKILLS.md) — skill selection UI / store
- [`CONNECTORS.md`](CONNECTORS.md) — connector selection UI / store

Backend counterpart:
[`../../../../back/src/modules/conversation-v2/README.md`](../../../../back/src/modules/conversation-v2/README.md).

## Table of Contents

- [Overview](#overview)
- [Application preview (Nodepod)](#application-preview-nodepod)
- [Event shape](#event-shape)
- [Store](#store)
- [UI layout](#ui-layout)
- [Boot lifecycle](#boot-lifecycle)
- [API client](#api-client)
- [Vite / service worker](#vite--service-worker)
- [i18n](#i18n)
- [Key files](#key-files)

---

## Overview

When Manus emits `application_component`, the frontend:

1. Opens the right panel in **Preview** mode.
2. Shows a **read-only** file tree from `files_tree`.
3. Downloads sources via batch signed URLs (`ceph_path` + relative paths).
4. Boots [`@scelar/nodepod`](https://github.com/R1ck404/Nodepod) in the browser,
   runs `npm install` + `npm run dev` (or `start`), and embeds the local
   Nodepod preview URL.
5. Lets the user **inspect** file contents (read-only) — no manual editing.

Deploy / Publish still uses the remote App Builder URL via `DeployControls`;
it no longer replaces the Nodepod preview URL.

## Application preview (Nodepod)

Replaces the previous remote-sandbox **iframe-only** preview.

| Piece | Role |
|---|---|
| `useNodepodPreview` | Hook UI mince qui lit la runtime registry et demande `ensureRuntime()` |
| `services/nodepod-runtime-manager.ts` | Boot / retry / eviction / warm pool Nodepod |
| `services/nodepod-runtime-registry.ts` | Registry memoire des runtimes par `sessionId:revision` |
| `services/nodepod-runtime-health.ts` | Resolution du port runtime + probes preview |
| `ApplicationComponentView` | Toolbar + split: file tree \| Preview / Source |
| `AppSourceFileTree` | Expandable, read-only tree |
| `AppSourceFileViewer` | Read-only code (CodeArtifact) + lock badge |
| `flattenFilesTree` | Tree → flat paths for signed-URL batch |

Users **cannot** edit generated sources in this panel — Source is inspection only.

## Event shape

From SSE / replay ([`types.ts`](types.ts)):

```ts
{
  type: 'application_component';
  event_id: string;
  timestamp: number;
  url: string;
  title?: string;
  ceph_path?: string;
  files_tree?: FilesTreeNode | null;
  file_count?: number;
}
```

`FilesTreeNode`:

```ts
{
  name: string;
  type: 'file' | 'directory';
  path?: string;   // files only
  size?: number;
  children?: FilesTreeNode[];
}
```

## Store

[`store.ts`](store.ts) keeps:

```ts
applicationComponent: {
  url: string;
  title: string;
  cephPath?: string;
  filesTree?: FilesTreeNode | null;
  fileCount?: number;
  revision: string;   // event_id — remounts Nodepod on new generation
} | null;
```

- Live: `handleEvent('application_component')` sets the object and
  `rightPanelMode: 'app'`.
- Replay / cache: `deriveApplicationComponent` takes the **last**
  `application_component` in history.
- `setDeployState` updates `deployedUrl` only — it does **not** overwrite
  Nodepod source fields.

## UI layout

```
┌─ RightPanel header ──────────────── [Publish] [✕] ─┐
│ [Code] [Preview●]                                   │
├─────────────────────────────────────────────────────┤
│ ✦ Title · N files · [Live]  [Preview|Source]  ▤ ↻   │
├──────────────┬──────────────────────────────────────┤
│ FILES        │  Preview → Nodepod iframe            │
│ ▾ app        │  Source  → read-only CodeArtifact    │
│   page.tsx   │                                      │
│ package.json │                                      │
└──────────────┴──────────────────────────────────────┘
```

Selecting a file switches the main pane to **Source** (read-only). Binary
files show a size message instead of a viewer.

## Boot lifecycle

`useNodepodPreview` delegue desormais a une architecture runtime en memoire:

- `runtimeKey = sessionId:revision`
- une runtime registry conserve les pods actifs en memoire
- un runtime manager orchestre `boot`, `reuse`, `retry`, `eviction`
- la detection de port est dynamique a partir de l'URL Nodepod, `onServerReady`
  et des logs du dev server
- un warm pool limite le nombre de runtimes actifs simultanes

Statuts:

`idle` → `queued` → `loading` (download) → `installing` (`npm install`) →
`starting` (`npm run dev`) → `ready` | `error`

- Exposes `files` map for the Source viewer once downloads succeed.
- Runtime state is session-scoped by `sessionId:revision`.
- Old runtimes for the same session are evicted when a new revision boots.
- Inactive runtimes are evicted automatically after a TTL / active-pool cap.
- Without `cephPath` + `filesTree`: stays `idle` with a waiting message
  (no remote sandbox iframe fallback).

## API client

[`api.ts`](api.ts):

```ts
conversationV2Api.getAppSourceUrls(sessionId, cephPath, paths)
// → { items: { path, url }[] }
```

Calls `POST /conversation-v2/sessions/:id/app-source/urls`.

## Vite / service worker

Nodepod needs `/__sw__.js` on the app origin. Configured in
[`vite.config.ts`](../../../vite.config.ts) via:

```ts
import nodepod from '@scelar/nodepod/vite';
plugins: [react(), tailwindcss(), nodepod()],
```

SharedArrayBuffer also requires cross-origin isolation headers on the
document origin (dev + prod):

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

Set in `vite.config.ts` (`server` / `preview`) and
[`nginx.conf`](../../../nginx.conf) for the production image. Prefer
`credentialless` over `require-corp` so Ceph/S3 signed downloads and API
calls keep working without CORP on every upstream.

Dependency: `@scelar/nodepod` in `front/package.json`.

## i18n

Keys under `nodepod.*` in [`locales/en.json`](locales/en.json) and
[`locales/fr.json`](locales/fr.json) (status badges, tabs, read-only, errors).

## Key files

| Path | Role |
|---|---|
| `hooks/useNodepodPreview.ts` | Hook React → registry/manager |
| `services/nodepod-runtime-manager.ts` | Lifecycle manager |
| `services/nodepod-runtime-registry.ts` | Runtime registry |
| `services/nodepod-runtime-health.ts` | Health + port resolution |
| `components/RightPanel/ApplicationComponentView.tsx` | Dual-pane UI |
| `components/RightPanel/AppSourceFileTree.tsx` | File tree |
| `components/RightPanel/AppSourceFileViewer.tsx` | Read-only source |
| `components/RightPanel/RightPanel.tsx` | Hosts the app view |
| `store.ts` | `applicationComponent` state |
| `types.ts` | Event + `FilesTreeNode` |
| `api.ts` | `getAppSourceUrls` |
| `utils/files-tree.ts` | Flatten tree for downloads |
| `utils/app-source.ts` | Icons / text vs binary helpers |
| `locales/en.json`, `locales/fr.json` | Copy |

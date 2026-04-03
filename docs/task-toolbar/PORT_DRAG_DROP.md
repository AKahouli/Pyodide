# Port-Aware Drag-and-Drop — Implementation README

> **Feature:** `task-toolbar` | **Status:** ✅ implemented | **Date:** 2026-04-03

---

## Overview

This feature lets users drag documents and workspaces from the **Workspace Explorer sidebar** directly onto specific **input ports** of playbook task nodes. The system infers the artifact type from the file extension, validates compatibility against the port's `artifactKind`, and stores the binding so the ADK knows exactly which document feeds which port at execution time.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Workspace Explorer Sidebar                                 │
│  ┌─ Workspace ─────────────────────────────────────────┐   │
│  │  ├─ report.pdf       [inferred: document]  [drag]  │   │
│  │  ├─ script.py        [inferred: code]     [drag]  │   │
│  │  └─ data.csv         [inferred: data]     [drag]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│          DragPayload: { type, id, name, artifactKind }      │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          PlaybookCanvasPage (ReactFlow Canvas)       │   │
│  │                                                     │   │
│  │  [in:document]◀──────────[out:text]▶                │   │
│  │  [in:code]◀─────────────[out:document]▶             │   │
│  │  [in:data]◀─────────────[out:data]▶                 │   │
│  │                     Task Node                        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Changed

| File | Role |
|------|------|
| `types.ts` | `InputFile` extended with `portId?: string` and `artifactKind?: ArtifactKind` |
| `store.ts` | `addInputFileToTask` — port-aware duplicate detection |
| `WorkspaceExplorerSidebar.tsx` | Enriches `DragPayload` with inferred `artifactKind` + `mimeType` |
| `PlaybookNode.tsx` | Port-aware drag handlers, persistent port labels, bound-file glow indicators |
| `InputFilesPopover.tsx` | Shows bound count badge, per-file artifact-kind color dot |
| `infer-artifact-kind.ts` | **NEW** — maps file extension / MIME type → `ArtifactKind` |
| `port-hit-detection.ts` | **NEW** — Y-offset coordinate → closest input port detection |
| `port-colors.ts` | Added `raw` CSS color field for inline style use |
| `node.tsx` (ai-elements) | Removed `overflow: hidden`; changed `h-auto` → `h-full` |
| `canvas.tsx` (ai-elements) | Passes `connectionLineComponent` to ReactFlow |
| `usePlaybookCanvas.ts` | Fixed edge creation to support multiple edges between same nodes |
| `api.ts` (playbook) | Strips `portId`, `artifactKind`, `mimeType` from PATCH payloads |

---

## Drag Payload Schema

```typescript
interface DragPayload {
  type: 'workspace' | 'document';
  id: string;
  name: string;
  workspaceId?: string;
  artifactKind?: ArtifactKind;  // inferred from extension/MIME
  metadata?: {
    workspaceId?: string;
    documentId?: string;
    filename?: string;
    filepath?: string;
    language?: string;
    mimeType?: string;
  };
}
```

---

## Port Binding Flow

### 1. Drag Start (WorkspaceExplorerSidebar)

When the user starts dragging a document, `handleDragStart` calls `inferArtifactKind()` and attaches the result to `dataTransfer`:

```typescript
const artifactKind = inferArtifactKind(document.filename, document.mimeType);
// → 'code' for .py, .js | 'document' for .pdf | 'data' for .csv | ...
e.dataTransfer.setData('application/json', JSON.stringify({ ..., artifactKind }));
```

### 2. Drag Over Node (PlaybookNode)

On `dragover`, the handler uses `detectPortHit()` to find the closest input port within a 28px vertical hit zone. The node border changes color based on whether a port is targeted.

### 3. Drop — Port Binding

```typescript
const hit = detectPortHit(inputPorts, offsetY, nodeHeight);
if (hit) {
  // File bound to specific port
  addInputFileToTask(id, { ...payload, portId: hit.port.id });
} else {
  // File added without port binding (generic input)
  addInputFileToTask(id, payload);
}
```

### 4. Store Persistence

`addInputFileToTask` stores the full `InputFile` (including `portId`) in the task's `inputFiles[]` array. The duplicate check is port-aware: the same file **can** be added to multiple different ports.

```typescript
// store.ts
const exists = existing.some((f) =>
  f.id === inputFile.id &&
  f.type === inputFile.type &&
  (!inputFile.portId || f.portId === inputFile.portId),
);
```

### 5. Backend Sanitization

`portId`, `artifactKind`, and `mimeType` are **client-only** fields stripped by `sanitizePlaybookUpdate()` before PATCH requests. The backend `InputFileItem` schema does not yet include these fields.

---

## Port Hit Detection

Uses Y-offset coordinate mapping — no HTML drop zones needed.

```typescript
// port-hit-detection.ts
export function detectPortHit(
  inputPorts: TaskInputPort[],
  dropOffsetY: number,   // cursor Y relative to node top
  nodeHeight: number,    // node bounding box height
): PortHit | null {
  // For each port, compute its expected Y position using the same
  // percentage formula as the flexbox layout:
  //   pct = 100 / (total + 1) * (idx + 1)
  //   portY = (pct / 100) * nodeHeight
  // Returns the port closest to dropOffsetY within HIT_ZONE_PX (28px)
}
```

The port position formula is:

```
pct = 100 / (totalPorts + 1) * (portIndex + 1)
```

This mirrors the `flex justify-around` distribution used in the node's DOM layout.

---

## Multi-Edge Support

ReactFlow's built-in `addEdge()` has internal deduplication based on `source + target + handle` which only allows **one edge per handle pair**. Since playbook nodes need **multiple edges between the same two nodes** (one per port pair), `onConnect` now directly pushes edges to state:

```typescript
// usePlaybookCanvas.ts — onConnect
const newEdgeId = `e-${source}-${sourcePortId}-${target}-${targetPortId}`;
if (eds.some((e) => e.id === newEdgeId)) return eds;  // dedupe by full edge id
return [...eds, newEdge];  // bypass addEdge() internal dedup
```

Edge ID format encodes both port IDs:

```
e-{sourceNodeId}-{sourcePortId}-{targetNodeId}-{targetPortId}
Example: e-task1-default-task2-source_doc
```

---

## Visual Design

### Port Dot
- 12×12px circle, colored by `artifactKind` (`raw` hex from `PORT_COLORS`)
- Rendered as ReactFlow `<Handle>` with `className="!w-3 !h-3"`
- Positioned by flexbox (`flex-col justify-around`) filling the full node height

### Persistent Label
- Every port always shows a label: `[icon] PortName`
- If a file is bound: `[icon] PortName: filename`
- Label positioned immediately to the left (input) or right (output) of the dot
- Uses `PORT_COLORS[kind].icon` for the lucide icon

### Bound File Glow
- Soft colored circle (20% opacity) behind the port dot when a file is bound
- Fades out during drag-over (pulsing ring takes its place)

### Drag-Over Feedback
- **Neutral ring** (blue) — hovering near a port, no compatibility check yet
- **Green ring** — `artifactKind` matches the port's expected kind
- **Red ring** — `artifactKind` mismatch
- **Node border** changes color based on overall drag-over state

### Compatibility Labels (drag-over only)
- Red badge: "expected: {artifactKind}" on mismatch
- Green badge: port name on match

---

## ArtifactKind Inference Map

```typescript
// infer-artifact-kind.ts
const EXT_KIND_MAP = {
  '.pdf': 'document',  '.docx': 'document',  '.txt': 'text',  '.md': 'text',
  '.py': 'code',       '.js': 'code',         '.ts': 'code',  '.java': 'code',
  '.csv': 'data',      '.xlsx': 'data',       '.json': 'data',
  '.png': 'image',     '.jpg': 'image',
  '.pptx': 'slide_deck',
};
```

---

## Open Issues / Limitations

### Known: Multi-Edge Deduplication (Investigation Ongoing)

When connecting two edges from the same source node to different target ports (e.g., A→X then B→Y), the second edge is visually created during the drag gesture but disappears after the connection completes, leaving only the first edge. This appears to be ReactFlow v12 internal edge reconciliation conflicting with the controlled `edges` state.

Current workaround attempts:
- Bypassed `addEdge()` internal dedup by using direct array spread `[...eds, newEdge]`
- Used full port-encoded edge IDs: `e-{srcNode}-{srcPortId}-{tgtNode}-{tgtPortId}`

If the issue persists, the next diagnostic step is to add a `useEffect` that logs `edges` state changes after every `onConnect` to determine whether ReactFlow's internal state diverges from the controlled state.

### Other Limitations

1. **Backend schema** — `portId` and `artifactKind` on `InputFile` are client-only. Backend `InputFileItem` schema needs these fields added for true persistence.
2. **Compatibility check during drag-over** — `getData()` is restricted outside drop events in most browsers; compatibility feedback only fires on `drop`.
3. **Workspace-level drop** — no auto-distribution of all workspace documents to matching ports.
4. **Port hit zone** — 28px is hardcoded; may need tuning for very small nodes.

---

## Testing Checklist

- [ ] Single-port node: drag file anywhere on node → file added, auto-bound to the only port
- [ ] Multi-port node: drag file near specific port → ring appears on that port, file bound correctly
- [ ] Multi-port node: drag file in the middle (no port hit) → file added without binding
- [ ] Drag same file to different ports → file appears under both ports (duplicate OK)
- [ ] Edge from output A to input X persists after creating edge from output B to input Y
- [ ] Ports always show colored dot + persistent label + icon
- [ ] Image file (.png) → red ring if port is not `image` kind; green if it is
- [ ] InputFilesPopover shows colored dot per file and bound count
- [ ] No TypeScript errors
- [ ] No backend 400 errors on PATCH (sanitization working)

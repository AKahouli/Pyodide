import type {
  PlaybookTask,
  PlaybookEdge,
  ControlEdge,
  DataBinding,
} from '../types';
import { RUNTIME_TASK_FIELDS } from './playbookExport';

export const PLAYBOOK_CLIPBOARD_VERSION = 1;

export interface PlaybookClipboardPayload {
  type: 'yellowstorm/playbook-nodes';
  version: 1;
  operation: 'copy' | 'cut';
  sourcePlaybookId: string;
  sourcePlaybookName?: string;
  copiedAt: string;
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
  controlEdges?: ControlEdge[];
  dataBindings: DataBinding[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  sourceTaskIds: string[];
}

const LOCAL_STORAGE_KEY = 'ys_playbook_clipboard_payload';
const PASTE_OFFSET_PX = 48;

function stripRuntimeTaskFields(task: PlaybookTask): PlaybookTask {
  const result = { ...task } as Record<string, unknown>;
  for (const field of RUNTIME_TASK_FIELDS) {
    delete result[field];
  }
  return result as unknown as PlaybookTask;
}

export function buildClipboardPayload(options: {
  tasks: PlaybookTask[];
  allEdges: PlaybookEdge[];
  allControlEdges?: ControlEdge[];
  allDataBindings: DataBinding[];
  selectedTaskIds: Set<string>;
  sourcePlaybookId: string;
  sourcePlaybookName?: string;
  operation: 'copy' | 'cut';
}): PlaybookClipboardPayload {
  const {
    tasks,
    allEdges,
    allControlEdges,
    allDataBindings,
    selectedTaskIds,
    sourcePlaybookId,
    sourcePlaybookName,
    operation,
  } = options;

  const selectedTasks = tasks
    .filter((t) => selectedTaskIds.has(t.id))
    .map(stripRuntimeTaskFields);

  const internalEdges = allEdges.filter(
    (e) => selectedTaskIds.has(e.sourceId) && selectedTaskIds.has(e.targetId),
  );

  const internalControlEdges = allControlEdges
    ? allControlEdges.filter(
        (ce) => selectedTaskIds.has(ce.source) && selectedTaskIds.has(ce.target),
      )
    : undefined;

  const internalBindings = allDataBindings.filter((db) => {
    if (db.sourceKind === 'node-output') {
      return (
        db.sourceNode &&
        selectedTaskIds.has(db.targetNode) &&
        selectedTaskIds.has(db.sourceNode)
      );
    }
    if (db.sourceKind === 'trigger') {
      return false;
    }
    return selectedTaskIds.has(db.targetNode);
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of selectedTasks) {
    minX = Math.min(minX, t.positionX);
    minY = Math.min(minY, t.positionY);
    maxX = Math.max(maxX, t.positionX);
    maxY = Math.max(maxY, t.positionY);
  }

  return {
    type: 'yellowstorm/playbook-nodes',
    version: PLAYBOOK_CLIPBOARD_VERSION,
    operation,
    sourcePlaybookId,
    sourcePlaybookName,
    copiedAt: new Date().toISOString(),
    tasks: selectedTasks,
    edges: internalEdges,
    controlEdges: internalControlEdges,
    dataBindings: internalBindings,
    bounds: { minX, minY, maxX, maxY },
    sourceTaskIds: [...selectedTaskIds],
  };
}

export function validateClipboardPayload(
  raw: unknown,
): PlaybookClipboardPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (obj.type !== 'yellowstorm/playbook-nodes') return null;
  if (obj.version !== PLAYBOOK_CLIPBOARD_VERSION) return null;
  if (obj.operation !== 'copy' && obj.operation !== 'cut') return null;
  if (typeof obj.sourcePlaybookId !== 'string') return null;
  if (typeof obj.copiedAt !== 'string') return null;
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) return null;
  if (!Array.isArray(obj.edges)) return null;
  if (!Array.isArray(obj.dataBindings)) return null;

  const taskIds = new Set<string>();
  for (const task of obj.tasks as unknown[]) {
    if (!task || typeof task !== 'object') return null;
    const t = task as Record<string, unknown>;
    if (typeof t.id !== 'string' || !t.id) return null;
    if (typeof t.title !== 'string') return null;
    if (typeof t.positionX !== 'number' || typeof t.positionY !== 'number') return null;
    taskIds.add(t.id);
  }

  for (const edge of obj.edges as unknown[]) {
    if (!edge || typeof edge !== 'object') return null;
    const e = edge as Record<string, unknown>;
    if (!taskIds.has(e.sourceId as string) || !taskIds.has(e.targetId as string)) return null;
  }

  if (obj.controlEdges !== undefined && obj.controlEdges !== null) {
    if (!Array.isArray(obj.controlEdges)) return null;
    for (const ce of obj.controlEdges as unknown[]) {
      if (!ce || typeof ce !== 'object') return null;
      const c = ce as Record<string, unknown>;
      if (!taskIds.has(c.source as string) || !taskIds.has(c.target as string)) return null;
    }
  }

  for (const db of obj.dataBindings as unknown[]) {
    if (!db || typeof db !== 'object') return null;
    const d = db as Record<string, unknown>;
    if (typeof d.targetNode !== 'string' || !taskIds.has(d.targetNode)) return null;
    if (d.sourceKind === 'node-output') {
      if (typeof d.sourceNode !== 'string' || !taskIds.has(d.sourceNode)) return null;
    }
    if (d.sourceKind === 'trigger') return null;
  }

  if (!obj.bounds || typeof obj.bounds !== 'object') return null;
  const bounds = obj.bounds as Record<string, unknown>;
  if (
    typeof bounds.minX !== 'number' || typeof bounds.minY !== 'number'
    || typeof bounds.maxX !== 'number' || typeof bounds.maxY !== 'number'
  ) return null;

  if (!Array.isArray(obj.sourceTaskIds)) return null;
  for (const sid of obj.sourceTaskIds as unknown[]) {
    if (typeof sid !== 'string' || !sid) return null;
    if (!taskIds.has(sid)) return null;
  }

  return obj as unknown as PlaybookClipboardPayload;
}

export async function writeClipboard(
  payload: PlaybookClipboardPayload,
): Promise<void> {
  const json = JSON.stringify(payload);
  try {
    await navigator.clipboard.writeText(json);
  } catch {
    // Browser clipboard may be blocked; rely on fallback
  }
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, json);
  } catch {
    // localStorage may be full or blocked
  }
}

export async function readClipboard(): Promise<PlaybookClipboardPayload | null> {
  let raw: string | null = null;
  try {
    raw = await navigator.clipboard.readText();
  } catch {
    // Browser clipboard may be blocked
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const validated = validateClipboardPayload(parsed);
      if (validated) return validated;
    } catch {
      // Not valid JSON, fall through
    }
  }

  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return validateClipboardPayload(parsed);
    }
  } catch {
    // localStorage may be unavailable
  }

  return null;
}

export interface RemappedPasteResult {
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
  pastedTaskIds: string[];
}

function generateId(): string {
  return crypto.randomUUID();
}

export function remapClipboardPayload(
  payload: PlaybookClipboardPayload,
  options: {
    pasteCount?: number;
    viewportCenter?: { x: number; y: number } | null;
  } = {},
): RemappedPasteResult {
  const { pasteCount = 0, viewportCenter = null } = options;

  const idMap = new Map<string, string>();
  for (const task of payload.tasks) {
    idMap.set(task.id, generateId());
  }

  const offsetMultiplier = pasteCount + 1;
  const offsetX = PASTE_OFFSET_PX * offsetMultiplier;
  const offsetY = PASTE_OFFSET_PX * offsetMultiplier;

  const originX = viewportCenter ? viewportCenter.x - (payload.bounds.maxX - payload.bounds.minX) / 2 : payload.bounds.minX + offsetX;
  const originY = viewportCenter ? viewportCenter.y - (payload.bounds.maxY - payload.bounds.minY) / 2 : payload.bounds.minY + offsetY;

  const remappedTasks: PlaybookTask[] = payload.tasks.map((task) => {
    const newId = idMap.get(task.id)!;
    const relativeX = task.positionX - payload.bounds.minX;
    const relativeY = task.positionY - payload.bounds.minY;

    const newParentId = task.containerConfig?.parentIteratorId;
    const remappedParentId = newParentId ? idMap.get(newParentId) ?? null : null;

    return {
      ...task,
      id: newId,
      positionX: originX + relativeX,
      positionY: originY + relativeY,
      containerConfig: remappedParentId
        ? { parentIteratorId: remappedParentId }
        : task.containerConfig?.parentIteratorId
          ? { parentIteratorId: null }
          : task.containerConfig ?? null,
    };
  });

  const remappedEdges: PlaybookEdge[] = payload.edges
    .filter((edge) => idMap.has(edge.sourceId) && idMap.has(edge.targetId))
    .map((edge) => ({
      ...edge,
      id: `e-${idMap.get(edge.sourceId)}-${edge.sourceOutputPortId ?? 'default'}-${idMap.get(edge.targetId)}-${edge.targetInputPortId ?? 'default'}`,
      sourceId: idMap.get(edge.sourceId)!,
      targetId: idMap.get(edge.targetId)!,
    }));

  const sourceControlEdges = payload.controlEdges ?? [];
  const remappedControlEdges: ControlEdge[] = sourceControlEdges
    .filter((ce) => idMap.has(ce.source) && idMap.has(ce.target))
    .map((ce) => ({
      ...ce,
      id: `ce-${idMap.get(ce.source)}->${idMap.get(ce.target)}${ce.routerLabel ? '#' + ce.routerLabel : ''}`,
      source: idMap.get(ce.source)!,
      target: idMap.get(ce.target)!,
    }));

  const remappedBindings: DataBinding[] = payload.dataBindings
    .filter((db) => idMap.has(db.targetNode) && (!db.sourceNode || idMap.has(db.sourceNode)))
    .map((db) => {
      const newTargetNode = idMap.get(db.targetNode)!;
      const newSourceNode = db.sourceNode ? idMap.get(db.sourceNode)! : undefined;
      return {
        ...db,
        id: `db-${newSourceNode ?? db.sourceKind}-${db.sourcePort ?? 'default'}-${newTargetNode}-${db.targetPort}`,
        targetNode: newTargetNode,
        sourceNode: newSourceNode,
      };
    });

  return {
    tasks: remappedTasks,
    edges: remappedEdges,
    controlEdges: remappedControlEdges,
    dataBindings: remappedBindings,
    pastedTaskIds: [...idMap.values()],
  };
}

export interface PlaybookClipSource {
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
  dataBindings: DataBinding[];
}

export function removeCutSourceItems(
  source: PlaybookClipSource,
  sourceTaskIds: string[],
): PlaybookClipSource {
  const ids = new Set(sourceTaskIds);

  return {
    tasks: source.tasks.filter((t) => !ids.has(t.id)),
    edges: source.edges.filter(
      (e) => !ids.has(e.sourceId) && !ids.has(e.targetId),
    ),
    dataBindings: source.dataBindings.filter(
      (b) => !ids.has(b.targetNode) && !(b.sourceNode && ids.has(b.sourceNode)),
    ),
  };
}

export interface CompatibilityWarning {
  taskId: string;
  taskTitle: string;
  kind: 'agent' | 'workspace' | 'connector';
  referenceId: string;
}

export interface PasteCompatibilityContext {
  agentIds: Set<string> | null;
  workspaceIds: Set<string>;
  connectorIds: Set<string> | null;
}

export function checkPasteCompatibility(
  tasks: PlaybookTask[],
  context: PasteCompatibilityContext,
): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];

  for (const task of tasks) {
    if (task.assignedAgentId && context.agentIds && !context.agentIds.has(task.assignedAgentId)) {
      warnings.push({
        taskId: task.id,
        taskTitle: task.title,
        kind: 'agent',
        referenceId: task.assignedAgentId,
      });
    }

    if (task.toolBindings && context.connectorIds) {
      for (const tb of task.toolBindings) {
        if (tb.connectorId && !context.connectorIds.has(tb.connectorId)) {
          warnings.push({
            taskId: task.id,
            taskTitle: task.title,
            kind: 'connector',
            referenceId: tb.connectorId,
          });
        }
      }
    }

    if (task.inputFiles) {
      for (const f of task.inputFiles) {
        if (f.workspaceId && !context.workspaceIds.has(f.workspaceId)) {
          warnings.push({
            taskId: task.id,
            taskTitle: task.title,
            kind: 'workspace',
            referenceId: f.workspaceId,
          });
        }
      }
    }
  }

  return warnings;
}

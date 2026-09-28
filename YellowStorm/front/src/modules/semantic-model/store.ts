import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { EditorMode, SaveStatus, SemanticGraph, SemanticGraphOperation, ValidationIssue } from './types';
import { applyGraphOperations, graphDiff } from './utils/graph-history';

export type SemanticOperationGroup = SemanticGraphOperation[];

/**
 * One step of Undo/Redo. A graph step keeps the graph before and after it; undoing saves the operations
 * that bring the graph back, so the server follows. An action step is a change saved through another
 * command (removing a source, for example) with its own way back and forth.
 */
export type HistoryEntry =
  | { kind: 'graph'; before: SemanticGraph; after: SemanticGraph; operations: SemanticOperationGroup }
  | { kind: 'action'; undo: () => Promise<void>; redo: () => Promise<void> };
interface SemanticModelEditorState {
  graph: SemanticGraph | null;
  mode: EditorMode;
  selectedId: string | null;
  /** Whether the details panel shows the selection. A click only selects; its actions appear on the canvas. */
  detailsOpen: boolean;
  pending: SemanticOperationGroup[];
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** An action step is being undone or redone. */
  historyBusy: boolean;
  validation: ValidationIssue[];
  /** Last request to bring an element into view; `at` makes repeat requests for the same id distinct. */
  focusRequest: { id: string; at: number } | null;
  /** Counts every selection, even of what is already selected, so panels can follow each click. */
  selectionTick: number;
  saveStatus: SaveStatus;
  saveInFlight: boolean;
  saveAttempt: number;
  hydrate: (graph: SemanticGraph) => void;
  setMode: (mode: EditorMode) => void;
  /** Select an element; `details` also opens its details panel. Selecting nothing closes the panel. */
  select: (id: string | null, options?: { details?: boolean }) => void;
  openDetails: (open: boolean) => void;
  /** Select an element and bring it into view on the canvas. */
  focus: (id: string) => void;
  commit: (operation: SemanticGraphOperation, update: (graph: SemanticGraph) => SemanticGraph) => void;
  commitBatch: (operations: SemanticOperationGroup, update: (graph: SemanticGraph) => SemanticGraph) => void;
  replaceGraph: (graph: SemanticGraph) => void;
  /**
   * Take the server's graph after someone else changed it (an assistant, for example) and replay the
   * edits still waiting to be saved on top of it, so they save against the new revision.
   */
  rebase: (server: SemanticGraph) => void;
  /** Record a change saved through another command, so Undo and Redo can reverse and repeat it. */
  pushAction: (entry: Omit<Extract<HistoryEntry, { kind: 'action' }>, 'kind'>) => void;
  markSaving: () => void;
  markSaved: (revision: number, savedGroupCount: number) => void;
  markFailed: (status: Extract<SaveStatus, 'offline' | 'error' | 'conflict'>) => void;
  /** Take the model revision returned by a direct command (identity, mapping, matching) so the next graph save does not conflict. */
  adoptRevision: (revision: number) => void;
  retrySave: () => void;
  setValidation: (issues: ValidationIssue[]) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  reset: () => void;
}

export function isSemanticGraphSaved(
  state: Pick<SemanticModelEditorState, 'graph' | 'pending' | 'saveStatus'>,
  expectedRevision?: number,
): boolean {
  return state.saveStatus === 'saved'
    && state.pending.length === 0
    && state.graph !== null
    && (expectedRevision === undefined || state.graph.revision === expectedRevision);
}

/** Resolves once every pending graph change has reached the server; rejects on a failed save or after `timeoutMs`. */
export function waitForGraphSave(timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('save_timeout')); }, timeoutMs);
    const check = (state: SemanticModelEditorState) => {
      if (isSemanticGraphSaved(state)) { clearTimeout(timer); unsubscribe(); resolve(); }
      else if (['error', 'conflict', 'offline'].includes(state.saveStatus)) { clearTimeout(timer); unsubscribe(); reject(new Error(state.saveStatus)); }
    };
    unsubscribe = useSemanticModelEditorStore.subscribe(check);
    check(useSemanticModelEditorStore.getState());
  });
}

export const semanticModelEditorInitialState = {
  graph: null,
  mode: 'structure' as EditorMode,
  selectedId: null,
  detailsOpen: false,
  pending: [] as SemanticOperationGroup[],
  undoStack: [] as HistoryEntry[],
  redoStack: [] as HistoryEntry[],
  historyBusy: false,
  validation: [] as ValidationIssue[],
  focusRequest: null as { id: string; at: number } | null,
  selectionTick: 0,
  saveStatus: 'saved' as SaveStatus,
  saveInFlight: false,
  saveAttempt: 0,
};

export function selectPendingOperations(pending: SemanticOperationGroup[], limit = 2000): { operations: SemanticGraphOperation[]; groupCount: number } {
  const groups: SemanticOperationGroup[] = [];
  let operationCount = 0;
  for (const group of pending) {
    if (operationCount + group.length > limit) break;
    groups.push(group);
    operationCount += group.length;
  }
  return { operations:groups.flat(),groupCount:groups.length };
}

export function isPendingSaveCurrent(
  state: Pick<SemanticModelEditorState,'graph'|'pending'>,
  versionId: string,
  groups: SemanticOperationGroup[],
): boolean {
  return state.graph?.versionId === versionId && groups.every((group,index)=>state.pending[index]===group);
}

const HISTORY_LIMIT = 50;

type StoreSet = (partial: Partial<SemanticModelEditorState> | ((state: SemanticModelEditorState) => Partial<SemanticModelEditorState>)) => void;

/**
 * Move the graph to one side of a history step. While the step's own operations are still waiting to be
 * saved they are simply dropped; otherwise the operations that get there are saved as a new change.
 */
function stepGraph(state: SemanticModelEditorState, entry: Extract<HistoryEntry, { kind: 'graph' }>, direction: 'undo' | 'redo') {
  const graph = state.graph!;
  const [from, to] = direction === 'undo' ? [entry.after, entry.before] : [entry.before, entry.after];
  const operations = graphDiff(from, to);
  const unsaved = direction === 'undo' && !state.saveInFlight && state.pending.length > 0 && state.pending.at(-1) === entry.operations;
  const pending = unsaved ? state.pending.slice(0, -1) : operations.length ? [...state.pending, operations] : state.pending;
  const saveStatus: SaveStatus = pending.length ? 'saving' : state.saveStatus === 'saving' ? 'saved' : state.saveStatus;
  return {
    graph: applyGraphOperations(graph, operations),
    pending,
    saveStatus,
    // Redone operations are new pending work; keep a reference so undoing again before the save can drop them.
    entry: direction === 'redo' && operations.length ? { ...entry, operations } : entry,
  };
}

async function stepAction(set: StoreSet, get: () => SemanticModelEditorState, direction: 'undo' | 'redo') {
  const state = get();
  const from = direction === 'undo' ? state.undoStack : state.redoStack;
  const entry = from.at(-1);
  if (!entry || entry.kind !== 'action' || state.historyBusy) return;
  const take = { historyBusy: true, ...(direction === 'undo' ? { undoStack: state.undoStack.slice(0, -1) } : { redoStack: state.redoStack.slice(0, -1) }) };
  set(take);
  try {
    await (direction === 'undo' ? entry.undo() : entry.redo());
    set((current) => direction === 'undo'
      ? { historyBusy: false, redoStack: [...current.redoStack, entry] }
      : { historyBusy: false, undoStack: [...current.undoStack, entry] });
  } catch {
    // Nothing changed: the step stays where it was so it can be tried again.
    set((current) => direction === 'undo'
      ? { historyBusy: false, undoStack: [...current.undoStack, entry] }
      : { historyBusy: false, redoStack: [...current.redoStack, entry] });
  }
}

export const useSemanticModelEditorStore = create<SemanticModelEditorState>()(devtools((set, get) => ({
  ...semanticModelEditorInitialState,
  hydrate: (graph) => set({ ...semanticModelEditorInitialState, graph }),
  setMode: (mode) => set({ mode, selectedId: null, detailsOpen: false }),
  select: (selectedId, options) => set((state) => ({ selectedId, detailsOpen: selectedId ? Boolean(options?.details) || state.detailsOpen : false, selectionTick: state.selectionTick + 1 })),
  openDetails: (detailsOpen) => set({ detailsOpen }),
  // Focusing is a request to look at something in full (a finding, a new element), so it opens its details.
  focus: (id) => set((state) => ({ selectedId: id, detailsOpen: true, focusRequest: { id, at: Date.now() }, selectionTick: state.selectionTick + 1 })),
  commit: (operation, update) => get().commitBatch([operation], update),
  commitBatch: (operations, update) => set((state) => {
    if (!state.graph || !operations.length) return state;
    const after = update(state.graph);
    const step: HistoryEntry = { kind: 'graph', before: state.graph, after, operations };
    return { graph: after, pending: [...state.pending, operations], undoStack: [...state.undoStack.slice(1 - HISTORY_LIMIT), step], redoStack: [], saveStatus: 'saving' };
  }),
  replaceGraph: (graph) => set({ graph }),
  rebase: (server) => set((state) => {
    if (!state.graph || state.graph.versionId !== server.versionId) return state;
    return { graph: { ...applyGraphOperations(server, state.pending.flat()), revision: server.revision } };
  }),
  pushAction: (entry) => set((state) => ({ undoStack: [...state.undoStack.slice(1 - HISTORY_LIMIT), { kind: 'action', ...entry }], redoStack: [] })),
  markSaving: () => set({ saveStatus: 'saving', saveInFlight: true }),
  markSaved: (revision, savedGroupCount) => set((state) => {
    const pending = state.pending.slice(savedGroupCount);
    return { graph: state.graph ? { ...state.graph, revision } : null, pending, saveStatus: pending.length ? 'saving' : 'saved', saveInFlight: false };
  }),
  markFailed: (saveStatus) => set({ saveStatus, saveInFlight: false }),
  // Mapping, identity and other model commands advance the *model* revision; graph saves are checked against the
  // draft *version* revision, a separate counter. Copying one into the other made the next autosave conflict,
  // so model revisions are deliberately not adopted into the graph.
  adoptRevision: () => undefined,
  retrySave: () => set((state) => state.saveStatus === 'error' || state.saveStatus === 'offline'
    ? { saveStatus:'saving',saveAttempt:state.saveAttempt+1 }
    : state),
  setValidation: (validation) => set({ validation }),
  undo: async () => {
    const state = get();
    const entry = state.undoStack.at(-1);
    if (!entry || !state.graph || state.historyBusy) return;
    if (entry.kind === 'action') return stepAction(set, get, 'undo');
    const { entry: moved, ...next } = stepGraph(state, entry, 'undo');
    set({ ...next, undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, moved] });
  },
  redo: async () => {
    const state = get();
    const entry = state.redoStack.at(-1);
    if (!entry || !state.graph || state.historyBusy) return;
    if (entry.kind === 'action') return stepAction(set, get, 'redo');
    const { entry: moved, ...next } = stepGraph(state, entry, 'redo');
    set({ ...next, redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, moved] });
  },
  reset: () => set(semanticModelEditorInitialState),
}), { name: 'semantic-model-editor-store' }));

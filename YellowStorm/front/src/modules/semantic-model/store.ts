import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { EditorMode, SaveStatus, SemanticGraph, SemanticGraphOperation, ValidationIssue } from './types';

export type SemanticOperationGroup = SemanticGraphOperation[];

interface HistoryEntry { graph: SemanticGraph; pending: SemanticOperationGroup[] }
interface SemanticModelEditorState {
  graph: SemanticGraph | null;
  mode: EditorMode;
  selectedId: string | null;
  /** Whether the details panel shows the selection. A click only selects; its actions appear on the canvas. */
  detailsOpen: boolean;
  pending: SemanticOperationGroup[];
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
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
  markSaving: () => void;
  markSaved: (revision: number, savedGroupCount: number) => void;
  markFailed: (status: Extract<SaveStatus, 'offline' | 'error' | 'conflict'>) => void;
  /** Take the model revision returned by a direct command (identity, mapping, matching) so the next graph save does not conflict. */
  adoptRevision: (revision: number) => void;
  retrySave: () => void;
  setValidation: (issues: ValidationIssue[]) => void;
  undo: () => void;
  redo: () => void;
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

export const useSemanticModelEditorStore = create<SemanticModelEditorState>()(devtools((set) => ({
  ...semanticModelEditorInitialState,
  hydrate: (graph) => set({ ...semanticModelEditorInitialState, graph }),
  setMode: (mode) => set({ mode, selectedId: null, detailsOpen: false }),
  select: (selectedId, options) => set((state) => ({ selectedId, detailsOpen: selectedId ? Boolean(options?.details) || state.detailsOpen : false, selectionTick: state.selectionTick + 1 })),
  openDetails: (detailsOpen) => set({ detailsOpen }),
  // Focusing is a request to look at something in full (a finding, a new element), so it opens its details.
  focus: (id) => set((state) => ({ selectedId: id, detailsOpen: true, focusRequest: { id, at: Date.now() }, selectionTick: state.selectionTick + 1 })),
  commit: (operation, update) => set((state) => {
    if (!state.graph) return state;
    const history = { graph: state.graph, pending: state.pending };
    return { graph: update(state.graph), pending: [...state.pending, [operation]], undoStack: [...state.undoStack.slice(-49), history], redoStack: [], saveStatus: 'saving' };
  }),
  commitBatch: (operations, update) => set((state) => {
    if (!state.graph || !operations.length) return state;
    const history = { graph:state.graph,pending:state.pending };
    return { graph:update(state.graph),pending:[...state.pending,operations],undoStack:[...state.undoStack.slice(-49),history],redoStack:[],saveStatus:'saving' };
  }),
  replaceGraph: (graph) => set({ graph }),
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
  undo: () => set((state) => {
    if (state.saveInFlight) return state;
    const previous = state.undoStack.at(-1);
    if (!previous || !state.graph) return state;
    return { graph: previous.graph, pending: previous.pending, undoStack: state.undoStack.slice(0,-1), redoStack: [...state.redoStack,{ graph: state.graph, pending: state.pending }], saveStatus: previous.pending.length ? 'saving' : 'saved' };
  }),
  redo: () => set((state) => {
    if (state.saveInFlight) return state;
    const next = state.redoStack.at(-1);
    if (!next || !state.graph) return state;
    return { graph: next.graph, pending: next.pending, redoStack: state.redoStack.slice(0,-1), undoStack: [...state.undoStack,{ graph: state.graph, pending: state.pending }], saveStatus: next.pending.length ? 'saving' : 'saved' };
  }),
  reset: () => set(semanticModelEditorInitialState),
}), { name: 'semantic-model-editor-store' }));

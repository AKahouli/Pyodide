import { beforeEach, describe, expect, it } from 'vitest';
import { isPendingSaveCurrent, isSemanticGraphSaved, selectPendingOperations, useSemanticModelEditorStore } from './store';
import type { SemanticGraph } from './types';

const graph: SemanticGraph = {
  modelId: 'model', versionId: 'version', revision: 1,
  nodes: [], relations: [], records: [], recordRelations: [],
};

describe('semantic model editor store', () => {
  beforeEach(() => useSemanticModelEditorStore.getState().reset());

  it('counts a click on what is already selected, so panels can follow it', () => {
    const { select } = useSemanticModelEditorStore.getState();
    select('customer');
    const before = useSemanticModelEditorStore.getState().selectionTick;
    select('customer');
    expect(useSemanticModelEditorStore.getState().selectionTick).toBe(before + 1);
  });

  it('tracks an operation and restores it through undo and redo', () => {
    const node = { id: 'node', key: 'party', label: 'Party', description: '', category: 'business_object' as const, recordPolicy: 'none' as const, systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 } };
    useSemanticModelEditorStore.getState().hydrate(graph);
    useSemanticModelEditorStore.getState().commit({ type: 'node_type.create', entity: node }, (current) => ({ ...current, nodes: [node] }));
    expect(useSemanticModelEditorStore.getState().graph?.nodes).toHaveLength(1);
    useSemanticModelEditorStore.getState().undo();
    expect(useSemanticModelEditorStore.getState().graph?.nodes).toHaveLength(0);
    useSemanticModelEditorStore.getState().redo();
    expect(useSemanticModelEditorStore.getState().graph?.nodes).toHaveLength(1);
  });

  it('saves the way back when undoing a change that already reached the server, and the way forward on redo', () => {
    const node = { id: 'node', key: 'party', label: 'Party', description: '', category: 'business_object' as const, recordPolicy: 'none' as const, systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 } };
    useSemanticModelEditorStore.getState().hydrate({ ...graph, nodes: [node] });
    useSemanticModelEditorStore.getState().commit({ type: 'node_type.delete', id: 'node' }, (current) => ({ ...current, nodes: [] }));
    useSemanticModelEditorStore.getState().markSaved(2, 1);
    void useSemanticModelEditorStore.getState().undo();
    expect(useSemanticModelEditorStore.getState().graph?.nodes).toEqual([node]);
    expect(useSemanticModelEditorStore.getState().pending).toEqual([[{ type: 'node_type.create', entity: node }]]);
    expect(useSemanticModelEditorStore.getState().saveStatus).toBe('saving');
    useSemanticModelEditorStore.getState().markSaved(3, 1);
    void useSemanticModelEditorStore.getState().redo();
    expect(useSemanticModelEditorStore.getState().pending).toEqual([[{ type: 'node_type.delete', id: 'node' }]]);
    // Undone again before that save, the redo is simply dropped.
    void useSemanticModelEditorStore.getState().undo();
    expect(useSemanticModelEditorStore.getState().pending).toEqual([]);
    expect(useSemanticModelEditorStore.getState().graph?.nodes).toEqual([node]);
  });

  it('undoes and redoes a change saved through another command, and keeps the step if that fails', async () => {
    useSemanticModelEditorStore.getState().hydrate(graph);
    const calls: string[] = [];
    let fail = false;
    useSemanticModelEditorStore.getState().pushAction({
      undo: async () => { if (fail) throw new Error('offline'); calls.push('undo'); },
      redo: async () => { calls.push('redo'); },
    });
    fail = true;
    await useSemanticModelEditorStore.getState().undo();
    expect(useSemanticModelEditorStore.getState().undoStack).toHaveLength(1);
    fail = false;
    await useSemanticModelEditorStore.getState().undo();
    expect(useSemanticModelEditorStore.getState()).toMatchObject({ historyBusy: false, undoStack: [] });
    await useSemanticModelEditorStore.getState().redo();
    expect(calls).toEqual(['undo', 'redo']);
    expect(useSemanticModelEditorStore.getState().undoStack).toHaveLength(1);
  });

  it('keeps operations added while an earlier autosave batch completes', () => {
    useSemanticModelEditorStore.getState().hydrate(graph);
    const operation = { type: 'layout.update' as const, positions: [] };
    useSemanticModelEditorStore.getState().commit(operation, (current) => current);
    useSemanticModelEditorStore.getState().commit(operation, (current) => current);
    useSemanticModelEditorStore.getState().markSaved(2, 1);
    expect(useSemanticModelEditorStore.getState().pending).toHaveLength(1);
    expect(useSemanticModelEditorStore.getState().graph?.revision).toBe(2);
  });

  it('commits a related operation group as one undo step', () => {
    useSemanticModelEditorStore.getState().hydrate(graph);
    const node = { id:'node',key:'party',label:'Party',description:'',category:'business_object' as const,recordPolicy:'optional' as const,systemKey:null,aliases:[],attributes:[],position:{x:0,y:0} };
    const relation = { id:'relation',key:'related_to',label:'related to',inverseLabel:'',description:'',sourceNodeTypeId:'source',targetNodeTypeId:'node',cardinality:'many_to_many' as const,traversable:true,filterable:true,attributes:[] };
    useSemanticModelEditorStore.getState().commitBatch(
      [{type:'node_type.create',entity:node},{type:'relation_type.create',entity:relation}],
      (current) => ({...current,nodes:[node],relations:[relation]}),
    );
    expect(useSemanticModelEditorStore.getState().pending[0]).toHaveLength(2);
    useSemanticModelEditorStore.getState().undo();
    expect(useSemanticModelEditorStore.getState().graph?.nodes).toEqual([]);
    expect(useSemanticModelEditorStore.getState().pending).toEqual([]);
  });

  it('never splits an operation group at the autosave limit', () => {
    const operation = { type:'layout.update' as const,positions:[] };
    const pending = [...Array.from({length:99},() => [operation]),[operation,operation]];
    expect(selectPendingOperations(pending, 100)).toEqual({ operations:Array(99).fill(operation),groupCount:99 });
  });

  it('retries recoverable failures without changing pending work', () => {
    useSemanticModelEditorStore.getState().hydrate(graph);
    useSemanticModelEditorStore.getState().commit({type:'layout.update',positions:[]},(current) => current);
    useSemanticModelEditorStore.getState().markFailed('error');
    useSemanticModelEditorStore.getState().retrySave();
    expect(useSemanticModelEditorStore.getState()).toMatchObject({saveStatus:'saving',saveAttempt:1});
    expect(useSemanticModelEditorStore.getState().pending).toHaveLength(1);
  });

  it('does not treat a save response from another hydration as current', () => {
    useSemanticModelEditorStore.getState().hydrate(graph);
    useSemanticModelEditorStore.getState().commit({type:'layout.update',positions:[]},(current)=>current);
    const groups = useSemanticModelEditorStore.getState().pending.slice(0,1);
    expect(isPendingSaveCurrent(useSemanticModelEditorStore.getState(),'version',groups)).toBe(true);
    useSemanticModelEditorStore.getState().hydrate({...graph,modelId:'other-model',versionId:'other-version'});
    expect(isPendingSaveCurrent(useSemanticModelEditorStore.getState(),'version',groups)).toBe(false);
  });

  it('only allows validation for the current fully saved revision', () => {
    expect(isSemanticGraphSaved({ graph, pending: [], saveStatus: 'saved' }, graph.revision)).toBe(true);
    expect(isSemanticGraphSaved({ graph, pending: [[{ type: 'layout.update', positions: [] }]], saveStatus: 'saving' })).toBe(false);
    expect(isSemanticGraphSaved({ graph, pending: [], saveStatus: 'error' })).toBe(false);
    expect(isSemanticGraphSaved({ graph, pending: [], saveStatus: 'saved' }, graph.revision + 1)).toBe(false);
  });
});

describe('adoptRevision', () => {
  it('never copies a model revision into the graph, whose saves are checked against the version revision', () => {
    const store = useSemanticModelEditorStore;
    store.getState().hydrate({ modelId: 'm', versionId: 'v', revision: 3, nodes: [], relations: [], records: [], recordRelations: [] });
    store.getState().adoptRevision(9);
    expect(store.getState().graph?.revision).toBe(3);
  });
});

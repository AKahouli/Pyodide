import { useCallback, useMemo, useRef, useState } from 'react';
import { showSuccess, showWarning } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModelEditorStore } from '../store';
import type { SemanticGraphOperation, SemanticRecord } from '../types';
import { recordsDeletion } from '../utils/graph-deletes';
import { applyGraphOperations } from '../utils/graph-history';
import { parseTable, tableToPatches, type ManualColumn, type RowPatch } from '../utils/manual-table';
import { chunkOperations, patchOperations } from '../utils/manual-table-ops';
import { announceUndoable } from '../utils/undo-notice';

/** A line of the grid: a record, or the blank line waiting for its first value (`record` null). */
export interface ManualRow {
  id: string;
  record: SemanticRecord | null;
}

const matchesFilter = (record: SemanticRecord, needle: string) =>
  record.label.toLocaleLowerCase().includes(needle)
  || Object.values(record.values ?? {}).some((value) => String(value ?? '').toLocaleLowerCase().includes(needle));

/**
 * The rows of a concept's manual table and the edits on them. Every edit is written to the model as record
 * operations in one undoable step; an edit bigger than the server takes in one save is split into several steps.
 */
export function useManualTable(conceptId: string, columns: ManualColumn[], canEdit: boolean, filter: string) {
  const { t } = useModuleTranslation('semantic-model');
  const records = useSemanticModelEditorStore((state) => state.graph?.records);
  const commitBatch = useSemanticModelEditorStore((state) => state.commitBatch);
  // Only one blank line at a time, always the last: it becomes a record when something is typed in it.
  const [draftId, setDraftState] = useState<string | null>(null);
  // Kept in step by hand: a handler run right after another (Enter after typing) must see the blank line as the last one left it.
  const draftRef = useRef<string | null>(null);
  const setDraftId = useCallback((id: string | null) => { draftRef.current = id; setDraftState(id); }, []);

  const stored = useMemo(() => (records ?? []).filter((record) => record.nodeTypeId === conceptId && record.status === 'active'), [records, conceptId]);
  const rows = useMemo<ManualRow[]>(() => {
    const needle = filter.trim().toLocaleLowerCase();
    const shown = needle ? stored.filter((record) => matchesFilter(record, needle)) : stored;
    const list: ManualRow[] = shown.map((record) => ({ id: record.id, record }));
    return draftId && canEdit ? [...list, { id: draftId, record: null }] : list;
  }, [stored, filter, draftId, canEdit]);

  // Handlers below are stable, so grid rows that did not change do not render again; they read what is current here.
  const latest = useRef({ rows, columns, canEdit, conceptId, t });
  latest.current = { rows, columns, canEdit, conceptId, t };

  const commitOperations = useCallback((operations: SemanticGraphOperation[]) => {
    for (const chunk of chunkOperations(operations)) commitBatch(chunk, (graph) => applyGraphOperations(graph, chunk));
  }, [commitBatch]);

  /** Write patches into the rows from `start` on; rows past the end become new records. Returns the operations count. */
  const writePatches = useCallback((start: number, patches: RowPatch[]) => {
    const { rows: current, columns: cols, canEdit: allowed, conceptId: concept } = latest.current;
    const draft = draftRef.current;
    const graph = useSemanticModelEditorStore.getState().graph;
    if (!allowed || !graph || !patches.length) return 0;
    const byId = new Map(graph.records.map((record) => [record.id, record]));
    // A row is looked up again by id: an edit just made to it may not have reached the grid yet.
    const targets = patches.map((_, offset) => {
      const row = current[start + offset];
      return row ? byId.get(row.id) ?? null : null;
    });
    const spare = draft ? [draft] : [];
    const operations = patchOperations(targets, patches, { conceptId: concept, columns: cols, newId: () => spare.shift() ?? crypto.randomUUID(), existingCount: graph.records.length });
    if (draft && spare.length === 0) setDraftId(null);
    if (operations.length) commitOperations(operations);
    return operations.length;
  }, [commitOperations, setDraftId]);

  const edit = useCallback((rowIndex: number, column: number, value: string) => { writePatches(rowIndex, [{ [column]: value.trim() }]); }, [writePatches]);

  const pasteText = useCallback((rowIndex: number, column: number, text: string) => {
    const { columns: cols, t: translate } = latest.current;
    const { patches } = tableToPatches(parseTable(text), cols, { startColumn: column, header: 'auto' });
    const count = writePatches(rowIndex, patches);
    if (count) showSuccess(translate('manualTable.pasted', { count: patches.length }));
  }, [writePatches]);

  /** Rows of a CSV file, added after the last row. */
  const importText = useCallback((text: string) => {
    const { rows: current, columns: cols, t: translate } = latest.current;
    const draft = draftRef.current;
    const { patches, header } = tableToPatches(parseTable(text), cols, { startColumn: 0, header: 'always' });
    if (!header) { showWarning(translate('manualTable.import.noMatch')); return; }
    const count = writePatches(current.length - (draft ? 1 : 0), patches);
    if (!count) { showWarning(translate('manualTable.import.empty')); return; }
    showSuccess(translate('manualTable.import.done', { count: patches.length }));
  }, [writePatches]);

  /** Make sure a blank line ends the table; returns its index in the grid. */
  const appendRow = useCallback(() => {
    const { rows: current, canEdit: allowed } = latest.current;
    if (!allowed) return null;
    if (draftRef.current) return current.length - 1;
    setDraftId(crypto.randomUUID());
    return current.length;
  }, [setDraftId]);

  const deleteRows = useCallback((ids: string[]) => {
    const graph = useSemanticModelEditorStore.getState().graph;
    if (!latest.current.canEdit || !graph || !ids.length) return;
    const deletion = recordsDeletion(graph, ids);
    commitOperations(deletion.operations);
    announceUndoable(latest.current.t(deletion.count === 1 ? 'manualTable.deleted_one' : 'manualTable.deleted_other', { count: deletion.count }), latest.current.t('action.undo'));
  }, [commitOperations]);

  return { rows, total: stored.length, edit, pasteText, importText, appendRow, deleteRows };
}

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showSuccess, showWarning } from '@/lib/notifications';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticGraph, SemanticRecord } from '../../types';
import { ManualTableEditor } from './ManualTableEditor';

vi.mock('@/lib/notifications', () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }));

const record = (id: string, label: string, values: Record<string, unknown> = {}, nodeTypeId = 'customer', status: SemanticRecord['status'] = 'active'): SemanticRecord =>
  ({ id, nodeTypeId, label, values, status, position: { x: 0, y: 0 } });

const concept = (id: string, label: string, attributes: Array<[string, string]>) => ({
  id, key: id, label, description: '', category: 'business_object' as const, recordPolicy: 'optional' as const, systemKey: null, aliases: [], position: { x: 0, y: 0 },
  attributes: attributes.map(([key, name]) => ({ key, label: name, type: 'text' as const, required: false })),
});

const baseGraph = (records: SemanticRecord[] = []): SemanticGraph => ({
  modelId: 'model', versionId: 'version', revision: 1,
  nodes: [concept('customer', 'Customer', [['email', 'Email'], ['city', 'City']]), concept('supplier', 'Supplier', [])],
  relations: [], records, recordRelations: [],
});

const state = () => useSemanticModelEditorStore.getState();
const operations = () => state().pending.flat();
const cell = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const type = (name: string, value: string) => { const input = cell(name); fireEvent.focus(input); input.value = value; fireEvent.blur(input); };
const paste = (name: string, text: string) => fireEvent.paste(cell(name), { clipboardData: { getData: () => text } });
const open = (canEdit = true) => render(<ManualTableEditor conceptId='customer' canEdit={canEdit} onClose={vi.fn()} />);

describe('ManualTableEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state().hydrate(baseGraph([
      record('r1', 'Ann', { email: 'ann@x.fr', city: 'Paris' }),
      record('r2', 'Bob', { email: 'bob@x.fr' }),
      record('r3', 'Cy'),
      record('s1', 'Other concept', {}, 'supplier'),
      record('i1', 'Inactive', {}, 'customer', 'inactive'),
    ]));
  });

  it('shows the active records of the concept: the name first, then one column per field', () => {
    open();
    expect(screen.getByRole('columnheader', { name: 'manualTable.name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'City' })).toBeInTheDocument();
    expect(cell('manualTable.name 1').value).toBe('Ann');
    expect(cell('Email 1').value).toBe('ann@x.fr');
    expect(cell('City 2').value).toBe('');
    expect(screen.queryByLabelText('manualTable.name 4')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('manualTable.rowCount_other');
  });

  it('edits a cell in place as one record update', () => {
    open();
    type('City 1', 'Lyon');
    expect(state().pending).toEqual([[{ type: 'record.update', id: 'r1', changes: { values: { email: 'ann@x.fr', city: 'Lyon' } } }]]);
    type('manualTable.name 3', 'Cyrille');
    expect(operations().at(-1)).toEqual({ type: 'record.update', id: 'r3', changes: { label: 'Cyrille' } });
  });

  it('puts an emptied name back instead of saving a nameless record', () => {
    open();
    type('manualTable.name 1', '');
    expect(state().pending).toEqual([]);
    expect(cell('manualTable.name 1').value).toBe('Ann');
  });

  it('adds a blank row that becomes a record once something is typed in it', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /manualTable.addRow/ }));
    expect(cell('manualTable.name 4').value).toBe('');
    expect(state().pending).toEqual([]);
    type('manualTable.name 4', 'Dee');
    expect(operations()).toEqual([expect.objectContaining({ type: 'record.create', entity: expect.objectContaining({ nodeTypeId: 'customer', label: 'Dee', status: 'active' }) })]);
    // The blank row turned into the record: no second one is made by the cell losing focus again.
    fireEvent.blur(cell('manualTable.name 4'));
    expect(operations()).toHaveLength(1);
    expect(state().graph!.records.filter((item) => item.nodeTypeId === 'customer')).toHaveLength(5);
  });

  it('names a new row after its first value when only a field is filled', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /manualTable.addRow/ }));
    type('City 4', 'Nice');
    expect(operations()[0]).toMatchObject({ type: 'record.create', entity: { label: 'Nice', values: { city: 'Nice' } } });
  });

  it('adds another row on Enter in the last one', async () => {
    open();
    const last = cell('manualTable.name 3');
    fireEvent.focus(last);
    fireEvent.keyDown(last, { key: 'Enter' });
    await waitFor(() => expect(cell('manualTable.name 4')).toHaveFocus());
    // Enter in an empty blank row adds nothing more.
    fireEvent.keyDown(cell('manualTable.name 4'), { key: 'Enter' });
    expect(screen.queryByLabelText('manualTable.name 5')).not.toBeInTheDocument();
    expect(state().pending).toEqual([]);
  });

  it('goes down a row on Enter', async () => {
    open();
    fireEvent.keyDown(cell('Email 1'), { key: 'Enter' });
    await waitFor(() => expect(cell('Email 2')).toHaveFocus());
  });

  describe('paste', () => {
    it('spreads cells copied from a spreadsheet from the focused cell, overwriting rows and adding the ones missing', () => {
      open();
      paste('Email 2', 'b2@x.fr\tLyon\nc2@x.fr\tNice\nd2@x.fr\tLille');
      expect(state().pending).toHaveLength(1);
      expect(operations().map((operation) => operation.type)).toEqual(['record.update', 'record.update', 'record.create']);
      const created = operations()[2] as Extract<ReturnType<typeof operations>[number], { type: 'record.create' }>;
      expect(created.entity).toMatchObject({ nodeTypeId: 'customer', label: 'd2@x.fr', values: { email: 'd2@x.fr', city: 'Lille' } });
      expect(cell('manualTable.name 2').value).toBe('Bob');
      expect(cell('Email 2').value).toBe('b2@x.fr');
      expect(cell('Email 4').value).toBe('d2@x.fr');
      expect(showSuccess).toHaveBeenCalledWith('manualTable.pasted');
    });

    it('matches a first row of column names to the fields and does not keep it as data', () => {
      open();
      paste('manualTable.name 1', 'City\tmanualTable.name\tEmail\nNice\tDee\td@x.fr\nLille\tEve\te@x.fr');
      const created = operations().filter((operation) => operation.type === 'record.create');
      // Rows are written from the focused row on: the two first records are updated, none is created for a header.
      expect(operations().map((operation) => operation.type)).toEqual(['record.update', 'record.update']);
      expect(created).toEqual([]);
      expect(cell('manualTable.name 1').value).toBe('Dee');
      expect(cell('City 2').value).toBe('Lille');
      expect(cell('Email 2').value).toBe('e@x.fr');
    });

    it('lets a single pasted value go into the box as plain text', () => {
      open();
      const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      event.clipboardData = { getData: () => 'just one value\r\n' };
      cell('City 1').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(state().pending).toEqual([]);
    });

    it('takes 500 pasted rows as one undoable step', async () => {
      open();
      const text = Array.from({ length: 500 }, (_, index) => `Person ${index}\tp${index}@x.fr\tCity ${index}`).join('\r\n') + '\r\n';
      fireEvent.click(screen.getByRole('button', { name: /manualTable.addRow/ }));
      paste('manualTable.name 4', text);
      expect(state().pending).toHaveLength(1);
      expect(state().pending[0]).toHaveLength(500);
      expect(state().graph!.records.filter((item) => item.nodeTypeId === 'customer')).toHaveLength(504);
      expect(state().undoStack).toHaveLength(1);
      await act(async () => { await state().undo(); });
      expect(state().graph!.records.filter((item) => item.nodeTypeId === 'customer')).toHaveLength(4);
    });

    it('splits a paste bigger than one save into steps the server accepts', () => {
      open();
      fireEvent.click(screen.getByRole('button', { name: /manualTable.addRow/ }));
      paste('manualTable.name 4', Array.from({ length: 4500 }, (_, index) => `P${index}`).join('\n'));
      expect(state().pending.map((group) => group.length)).toEqual([2000, 2000, 500]);
      expect(state().graph!.records.filter((item) => item.nodeTypeId === 'customer')).toHaveLength(4504);
    });
  });

  describe('selection and deletion', () => {
    const rowBoxes = () => screen.getAllByRole('checkbox', { name: 'manualTable.selectRow' });

    it('deletes the rows ticked, a range with Shift, with the links made with them, as one undoable step', async () => {
      state().hydrate({
        ...baseGraph([record('r1', 'Ann'), record('r2', 'Bob'), record('r3', 'Cy'), record('r4', 'Di'), record('r5', 'Eve')]),
        recordRelations: [{ id: 'link', relationTypeId: 'rel', sourceRecordId: 'r2', targetRecordId: 'r5', values: {} }],
      });
      open();
      const remove = screen.getByRole('button', { name: /manualTable.deleteSelected/ });
      expect(remove).toBeDisabled();
      fireEvent.click(rowBoxes()[1]);
      fireEvent.click(rowBoxes()[3], { shiftKey: true });
      expect(rowBoxes().map((box) => (box as HTMLInputElement).checked)).toEqual([false, true, true, true, false]);
      fireEvent.click(rowBoxes()[2]);
      fireEvent.click(remove);

      expect(state().pending).toHaveLength(1);
      expect(operations().map((operation) => operation.type)).toEqual(['record_relation.delete', 'record.delete', 'record.delete']);
      expect(state().graph!.records.map((item) => item.id)).toEqual(['r1', 'r3', 'r5']);
      expect(state().graph!.recordRelations).toEqual([]);
      expect(showSuccess).toHaveBeenCalledWith('manualTable.deleted_other', expect.objectContaining({ action: expect.objectContaining({ label: 'action.undo' }) }));
      expect(remove).toBeDisabled();
      await act(async () => { await state().undo(); });
      expect(state().graph!.records).toHaveLength(5);
      expect(state().graph!.recordRelations).toHaveLength(1);
    });

    it('selects every row from the header box', () => {
      open();
      fireEvent.click(screen.getByRole('checkbox', { name: 'manualTable.selectAll' }));
      expect(rowBoxes().every((box) => (box as HTMLInputElement).checked)).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: /manualTable.deleteSelected/ }));
      expect(state().graph!.records.map((item) => item.id)).toEqual(['s1', 'i1']);
    });
  });

  it('shows the table without letting it change when the model cannot be edited', () => {
    open(false);
    expect(screen.queryByRole('button', { name: /manualTable.addRow/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(cell('manualTable.name 1')).toHaveAttribute('readonly');
    paste('Email 1', 'a\tb\nc\td');
    type('City 1', 'Lyon');
    expect(state().pending).toEqual([]);
    expect(screen.getByText('manualTable.readOnly')).toBeInTheDocument();
  });

  it('filters the rows by what they hold', () => {
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'manualTable.filter' }), { target: { value: 'paris' } });
    expect(cell('manualTable.name 1').value).toBe('Ann');
    expect(screen.queryByLabelText('manualTable.name 2')).not.toBeInTheDocument();
  });

  it('draws only the rows in view when the table is long', () => {
    state().hydrate(baseGraph(Array.from({ length: 2000 }, (_, index) => record(`r${index}`, `Person ${index}`))));
    open();
    expect(screen.getByRole('status')).toHaveTextContent('manualTable.rowCount_other');
    expect(screen.getAllByRole('checkbox', { name: 'manualTable.selectRow' }).length).toBeLessThan(60);
  });

  describe('CSV import', () => {
    const importFile = (content: string) => {
      const input = screen.getByLabelText('manualTable.import.file');
      fireEvent.change(input, { target: { files: [{ text: async () => content }] } });
    };

    it('adds the rows of a file after the last one, its columns matched to the fields by name', async () => {
      open();
      importFile(['manualTable.name;Email;City;Unknown', 'Dee;d@x.fr;"Aix; Provence";1', 'Eve;e@x.fr;Nice;2', ''].join('\n'));
      await waitFor(() => expect(state().graph!.records.filter((item) => item.nodeTypeId === 'customer')).toHaveLength(6));
      expect(state().pending).toHaveLength(1);
      expect(operations()[0]).toMatchObject({ type: 'record.create', entity: { label: 'Dee', values: { email: 'd@x.fr', city: 'Aix; Provence' } } });
      expect(showSuccess).toHaveBeenCalledWith('manualTable.import.done');
    });

    it('says so when no column of the file is a field, and changes nothing', async () => {
      open();
      importFile('foo,bar\n1,2');
      await waitFor(() => expect(showWarning).toHaveBeenCalledWith('manualTable.import.noMatch'));
      expect(state().pending).toEqual([]);
    });
  });
});

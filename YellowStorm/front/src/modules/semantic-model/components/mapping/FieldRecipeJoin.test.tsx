import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputedFieldRule, SourceFieldMapping } from '../../types';
import { computedPayload, computedProblem, FieldRecipeEditor, newColumnRecipe, recipeColumns, recipeReadsField, type RecipeSource } from './FieldRecipeEditor';
import { recipeInputs } from './FieldMappingList';
import { usedSourceFields } from './derivedMapping';

const api = vi.hoisted(() => ({ previewComputedField: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));
// Keys, with the parts of a join's summary, so the summary can be read.
vi.mock('@/modules/localization', async () => {
  const actual = await vi.importActual<typeof import('@/modules/localization')>('@/modules/localization');
  return { ...actual, useModuleTranslation: () => ({ t: (key: string, options?: { parts?: string }) => options?.parts ? `${key}: ${options.parts}` : key, language: 'en', ready: true }) };
});

const FIELDS = [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }];
const documents: RecipeSource = {
  kind: 'document', fileSamples: ['a.eml', 'b.eml'],
  documentRows: [
    { key: 'd1', label: 'a.eml', fileName: 'a.eml', values: { name: 'Jean Dupont', email: 'jd@x.org' } },
    { key: 'd2', label: 'b.eml', fileName: 'b.eml', values: { email: 'solo@x.org' } },
  ],
};

function Harness({ onRule, source = documents, initial }: Readonly<{ onRule?: (rule: ComputedFieldRule) => void; source?: RecipeSource; initial: ComputedFieldRule }>) {
  const [rule, setRule] = useState(initial);
  return <FieldRecipeEditor modelId='model-1' fieldLabel='Sender' rule={rule} fields={FIELDS} source={source}
    onChange={(next) => { setRule(next); onRule?.(next); }} />;
}

const fromName: ComputedFieldRule = { input: { kind: 'field', name: 'name' }, method: 'whole', transform: 'none' };
const sender: ComputedFieldRule = {
  input: { kind: 'join', parts: [{ kind: 'field', name: 'name' }, { kind: 'text', value: ' <' }, { kind: 'field', name: 'email' }, { kind: 'text', value: '>' }], separator: '', skipEmpty: true },
  method: 'whole', transform: 'none',
};

async function choose(combobox: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: combobox }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('FieldRecipeEditor: join several', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.previewComputedField.mockReset().mockResolvedValue({ results: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('starts a join from the current input and the next one, then adds, reorders and removes parts', async () => {
    const onRule = vi.fn();
    render(<Harness initial={fromName} onRule={onRule} />);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.input' }));
    await choose('mapping.computed.input', 'mapping.recipe.join.option');
    expect(onRule).toHaveBeenLastCalledWith(expect.objectContaining({
      input: { kind: 'join', parts: [{ kind: 'field', name: 'name' }, { kind: 'field', name: 'email' }], separator: ' ', skipEmpty: true } }));

    fireEvent.click(screen.getByRole('button', { name: 'mapping.recipe.join.addText' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'mapping.recipe.join.textFor' }), { target: { value: ' <' } });
    // The text moves between the two fields.
    fireEvent.click(screen.getAllByRole('button', { name: 'mapping.recipe.join.moveUp' })[2]);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.recipe.join.addText' }));
    fireEvent.change(screen.getAllByRole('textbox', { name: 'mapping.recipe.join.textFor' })[1], { target: { value: '>' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'mapping.recipe.join.separator' }), { target: { value: '' } });
    const last = onRule.mock.lastCall![0] as ComputedFieldRule;
    expect(computedPayload(last)).toEqual(sender);
    expect(computedProblem(last, ['name', 'email'])).toBeNull();

    // A part removed; the last two can never be removed.
    fireEvent.click(screen.getAllByRole('button', { name: 'mapping.recipe.join.remove' })[3]);
    expect((onRule.mock.lastCall![0] as ComputedFieldRule).input).toMatchObject({ parts: [{ name: 'name' }, { value: ' <' }, { name: 'email' }] });
    fireEvent.click(screen.getAllByRole('button', { name: 'mapping.recipe.join.remove' })[1]);
    const removeButtons = screen.getAllByRole('button', { name: 'mapping.recipe.join.remove' });
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getAllByRole('button', { name: 'mapping.recipe.join.moveUp' })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('sums up the parts on the folded pane and tries the join on the documents read, part by part', async () => {
    api.previewComputedField.mockResolvedValue({ results: [
      { input: 'Jean Dupont <jd@x.org>', value: 'Jean Dupont <jd@x.org>', reason: 'found', steps: [{ step: 'join', value: 'Jean Dupont <jd@x.org>' }] },
      { input: '<solo@x.org>', value: '<solo@x.org>', reason: 'found', steps: [{ step: 'join', value: '<solo@x.org>' }] },
    ] });
    render(<Harness initial={sender} />);
    expect(screen.getByText('mapping.recipe.join.summary: Name + “ <” + Email + “>”')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(api.previewComputedField).toHaveBeenLastCalledWith('model-1', {
      computed: computedPayload(sender),
      partSamples: [{ 'field:name': 'Jean Dupont', 'field:email': 'jd@x.org' }, { 'field:name': '', 'field:email': 'solo@x.org' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.preview' }));
    expect(screen.getAllByText('Jean Dupont <jd@x.org>').length).toBeGreaterThan(0);
  });

  it('joins sheet columns and fields, with a field shaped by its own recipe first', async () => {
    const own = { input: { kind: 'column' as const, name: 'Last' }, method: 'whole' as const, transform: 'upper' as const };
    const sheet: RecipeSource = { kind: 'sheet', columns: ['First', 'Last'], rows: [{ __sheetRow: 2, First: 'Ada', Last: 'Lovelace' }],
      fieldInputs: { email: { column: 'Last', recipe: own } } };
    const rule: ComputedFieldRule = { input: { kind: 'join', parts: [{ kind: 'column', name: 'First' }, { kind: 'field', name: 'email' }] }, method: 'whole', transform: 'none' };
    render(<Harness initial={rule} source={sheet} />);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(api.previewComputedField).toHaveBeenLastCalledWith('model-1', {
      computed: expect.objectContaining({ input: { kind: 'join', parts: rule.input.kind === 'join' ? rule.input.parts : [], separator: ' ', skipEmpty: true } }),
      partSamples: [{ 'column:First': 'Ada', 'field:email': 'Lovelace' }],
      partRecipes: { 'field:email': computedPayload(own) },
    });
  });

  it('preselects the first input offered when a field taken from another starts with none', () => {
    const onRule = vi.fn();
    const sheet: RecipeSource = { kind: 'sheet', columns: ['First', 'Last'], rows: [], fieldInputs: {} };
    render(<Harness initial={newColumnRecipe('')} source={sheet} onRule={onRule} />);
    expect(onRule).toHaveBeenCalledWith(expect.objectContaining({ input: { kind: 'column', name: 'First' } }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses a join with too few parts, only texts, an empty text or an unknown field', () => {
    const join = (parts: unknown[], extra = {}) => ({ input: { kind: 'join', parts, ...extra }, method: 'whole' }) as ComputedFieldRule;
    expect(computedProblem(join([{ kind: 'field', name: 'name' }]), ['name'])).toBe('mapping.computed.problem.joinParts');
    expect(computedProblem(join([{ kind: 'text', value: 'a' }, { kind: 'text', value: 'b' }]), [])).toBe('mapping.computed.problem.joinParts');
    expect(computedProblem(join([{ kind: 'field', name: 'name' }, { kind: 'text', value: '' }]), ['name'])).toBe('mapping.computed.problem.joinText');
    expect(computedProblem(join([{ kind: 'field', name: 'name' }, { kind: 'field', name: 'gone' }]), ['name'])).toBe('mapping.computed.problem.input');
    expect(computedProblem(join([{ kind: 'field', name: 'name' }, { kind: 'column', name: 'x' }], { separator: 'x'.repeat(11) }), ['name'])).toBe('mapping.computed.problem.joinSeparator');
  });

  it('a field joining another field can be read by a third, but never in a loop; its columns count as read', () => {
    const mappings: SourceFieldMapping[] = [
      { sourceField: 'First', targetAttribute: 'first', mode: 'direct' },
      { sourceField: null, targetAttribute: 'full', mode: 'computed', computed: { input: { kind: 'join', parts: [{ kind: 'field', name: 'first' }, { kind: 'column', name: 'Last' }] }, method: 'whole' } },
      { sourceField: null, targetAttribute: 'cols', mode: 'computed', computed: { input: { kind: 'join', parts: [{ kind: 'column', name: 'A' }, { kind: 'column', name: 'B' }] }, method: 'whole' } },
    ];
    expect(recipeReadsField(mappings[1].computed)).toBe(true);
    expect(recipeInputs(mappings, 'other', 'sheet')).toEqual(['first', 'full', 'cols']);
    // `full` reads `first`, so `first` cannot read `full` back; a fixed field is read on a sheet, not on a record.
    expect(recipeInputs(mappings, 'first', 'sheet')).toEqual(['cols']);
    const fixed: SourceFieldMapping[] = [...mappings, { sourceField: null, targetAttribute: 'country', mode: 'constant', constantValue: 'FR' }];
    expect(recipeInputs(fixed, 'other', 'sheet')).toContain('country');
    expect(recipeInputs(fixed, 'other', 'record')).not.toContain('country');
    expect(recipeColumns(mappings[1].computed)).toEqual(['Last']);
    expect(usedSourceFields([{ targetAttribute: 'cols', mode: 'computed', computed: mappings[2].computed }])).toEqual(['A', 'B']);
  });
});

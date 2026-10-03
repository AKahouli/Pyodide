import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputedFieldRule } from '../../types';
import { computedPayload, computedProblem, FieldRecipeEditor, newColumnRecipe, recipeStepCount, type RecipeSource } from './FieldRecipeEditor';
import { sheetFieldPayload } from './SourceMappingDrawer';

const api = vi.hoisted(() => ({ previewComputedField: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ __sheetRow: index + 2, ref: `FY${2020 + index}_x`, id: `C-${index}` }));

function Harness({ onRule, source, initial }: Readonly<{ onRule?: (rule: ComputedFieldRule) => void; source: RecipeSource; initial?: ComputedFieldRule }>) {
  const [rule, setRule] = useState(initial ?? newColumnRecipe('ref'));
  return <FieldRecipeEditor modelId='model-1' fieldLabel='Year' rule={rule} fields={[{ key: 'id', label: 'Id' }]} source={source}
    onChange={(next) => { setRule(next); onRule?.(next); }} />;
}

const sheet = (count = 7, fieldInputs: Extract<RecipeSource, { kind: 'sheet' }>['fieldInputs'] = { id: { column: 'id' } }): RecipeSource =>
  ({ kind: 'sheet', columns: ['ref', 'id'], rows: rows(count), fieldInputs });

describe('FieldRecipeEditor on a sheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.previewComputedField.mockReset().mockResolvedValue({ results: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('starts folded on its own column, kept whole', () => {
    render(<Harness source={sheet()} />);
    for (const title of ['mapping.computed.input', 'mapping.computed.method', 'mapping.rules.take.keep', 'mapping.rules.pattern', 'mapping.rules.transform', 'mapping.recipe.previewRows']) {
      expect(screen.getByRole('button', { name: title }).getAttribute('aria-expanded')).toBe('false');
    }
    expect(screen.getByText('mapping.recipe.columnOption')).toBeTruthy();
    expect(screen.getByText('mapping.recipe.methodSummary.whole')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.method' }));
    expect(screen.getByRole('tab', { name: 'mapping.recipe.methods.whole' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'mapping.computed.methods.split' })).toBeTruthy();
  });

  it('tries the recipe on the first rows, then on the rows ticked', async () => {
    const onRule = vi.fn();
    render(<Harness source={sheet()} onRule={onRule} />);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(api.previewComputedField).toHaveBeenLastCalledWith('model-1', { computed: expect.objectContaining({ method: 'whole' }), samples: rows(5).map((row) => row.ref) });
    fireEvent.click(screen.getByRole('button', { name: 'mapping.recipe.previewRows' }));
    const boxes = screen.getAllByRole('checkbox', { name: 'mapping.recipe.rowFor' });
    expect(boxes).toHaveLength(7);
    expect(boxes.filter((box) => (box as HTMLInputElement).checked)).toHaveLength(5);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[6]);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(api.previewComputedField).toHaveBeenLastCalledWith('model-1', expect.objectContaining({ samples: ['FY2021_x', 'FY2022_x', 'FY2023_x', 'FY2024_x', 'FY2026_x'] }));
    expect(screen.queryByRole('textbox', { name: 'mapping.recipe.rowsFilter' })).toBeNull();
  });

  it('filters many rows and ticks at most 20', () => {
    render(<Harness source={sheet(25)} />);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.recipe.previewRows' }));
    const boxes = screen.getAllByRole('checkbox', { name: 'mapping.recipe.rowFor' });
    for (const box of boxes.slice(5, 22)) fireEvent.click(box);
    expect(boxes.filter((box) => (box as HTMLInputElement).checked)).toHaveLength(20);
    expect((boxes[24] as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'mapping.recipe.rowsFilter' }), { target: { value: 'FY2024' } });
    expect(screen.getAllByRole('checkbox', { name: 'mapping.recipe.rowFor' })).toHaveLength(1);
  });

  it('shows the value at each step, the final value and why nothing was found', async () => {
    api.previewComputedField.mockResolvedValue({ results: [
      { input: 'FY2020_x', value: '2020', reason: 'found', steps: [{ step: 'cut', value: 'FY2020' }, { step: 'pattern', value: '2020' }] },
      { input: 'FY2021_x', value: null, reason: 'no_match', steps: [{ step: 'cut', value: null }] },
    ] });
    render(<Harness source={sheet(2)} />);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.recipe.previewRows' }));
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(screen.getByText('2020')).toBeTruthy();
    expect(screen.getByText('mapping.reading.reason.no_match')).toBeTruthy();
    const steps = screen.getAllByLabelText('mapping.recipe.stepsFor');
    expect(steps[0].textContent).toBe('mapping.recipe.step.cut: FY2020 → mapping.recipe.step.pattern: 2020');
    expect(steps[1].textContent).toBe('mapping.recipe.step.cut: mapping.recipe.stepNone');
  });

  it('taken from another field, tries that field\'s column shaped by its own recipe first', async () => {
    const own = { input: { kind: 'column' as const, name: 'id' }, method: 'split' as const, delimiter: '-', part: 2, transform: 'none' as const };
    render(<Harness source={sheet(2, { id: { column: 'id', recipe: own } })} initial={{ input: { kind: 'field', name: 'id' }, method: 'whole', transform: 'number' }} />);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(api.previewComputedField).toHaveBeenLastCalledWith('model-1', { computed: expect.objectContaining({ input: { kind: 'field', name: 'id' } }), samples: ['C-0', 'C-1'], inputRecipe: computedPayload(own) });
  });

  it('builds a payload without the settings of other methods', () => {
    expect(computedPayload({ ...newColumnRecipe('ref'), delimiter: '_', part: 2, take: { from: 'end', count: 4, unit: 'characters' } }))
      .toEqual({ input: { kind: 'column', name: 'ref' }, method: 'whole', transform: 'none', take: { from: 'end', count: 4, unit: 'characters' } });
  });

  it('counts the steps that change the value, and saves a field read as it is without a recipe', () => {
    expect(recipeStepCount(newColumnRecipe('ref'), 'ref')).toBe(0);
    expect(recipeStepCount(newColumnRecipe('other'), 'ref')).toBe(1);
    expect(recipeStepCount({ ...newColumnRecipe('ref'), method: 'split', delimiter: '_', part: 1, transform: 'upper' }, 'ref')).toBe(2);
    expect(sheetFieldPayload({ sourceField: 'ref', targetAttribute: 'year', mode: 'direct', computed: newColumnRecipe('ref') }))
      .toEqual({ sourceField: 'ref', targetAttribute: 'year', mode: 'direct' });
    expect(sheetFieldPayload({ sourceField: 'ref', targetAttribute: 'year', mode: 'direct', computed: { ...newColumnRecipe('ref'), transform: 'year' } }).computed)
      .toEqual({ input: { kind: 'column', name: 'ref' }, method: 'whole', transform: 'year' });
  });

  it('refuses a column the sheet does not have', () => {
    expect(computedProblem(newColumnRecipe('gone'), [], ['ref'])).toBe('mapping.computed.problem.input');
    expect(computedProblem(newColumnRecipe('ref'), [], ['ref'])).toBeNull();
  });
});

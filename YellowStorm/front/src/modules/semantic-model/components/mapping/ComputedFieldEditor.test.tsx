import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputedFieldRule } from '../../types';
import { ComputedFieldEditor, computedPayload, computedProblem, newComputedRule } from './ComputedFieldEditor';

const api = vi.hoisted(() => ({ previewComputedField: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));

const FILE = 'JOHNSON_JOHNSON_2023_8K_dated-2023-08-23.pdf';

function Harness({ onRule, files = [FILE] }: Readonly<{ onRule?: (rule: ComputedFieldRule) => void; files?: string[] }>) {
  const [rule, setRule] = useState(newComputedRule());
  return <ComputedFieldEditor modelId='model-1' fieldLabel='Fiscal year' rule={rule} fields={[{ key: 'title', label: 'Title' }]} fileSamples={files}
    onChange={(next) => { setRule(next); onRule?.(next); }} />;
}

describe('ComputedFieldEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.previewComputedField.mockReset().mockResolvedValue({ results: [{ input: FILE, value: '2023', reason: 'found' }] });
  });
  afterEach(() => vi.useRealTimers());

  it('starts with every step folded, each showing its setting', () => {
    render(<Harness />);
    for (const title of ['mapping.computed.input', 'mapping.computed.method', 'mapping.rules.take.keep', 'mapping.rules.pattern', 'mapping.rules.transform', 'mapping.computed.preview']) {
      expect(screen.getByRole('button', { name: title }).getAttribute('aria-expanded')).toBe('false');
    }
    expect(screen.queryByRole('tab', { name: 'mapping.computed.methods.split' })).toBeNull();
    expect(screen.getByText('mapping.computed.methodSummary.split')).toBeTruthy();
    expect(screen.getByText('mapping.rules.take.mode.all')).toBeTruthy();
    expect(screen.getByText('mapping.rules.transformOption.none')).toBeTruthy();
  });

  it('renders the simple methods and keeps the pattern behind Advanced', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.method' }));
    expect(screen.getByRole('tab', { name: 'mapping.computed.methods.split' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'mapping.computed.methods.between' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'mapping.computed.methods.regex' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.showAdvanced' }));
    expect(screen.getByRole('tab', { name: 'mapping.computed.methods.regex' })).toBeTruthy();
  });

  it('builds a split-from-the-end payload', () => {
    const onRule = vi.fn();
    render(<Harness onRule={onRule} />);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.method' }));
    fireEvent.change(screen.getByLabelText('mapping.computed.position'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('mapping.computed.fromEnd'));
    const rule = onRule.mock.calls.at(-1)![0] as ComputedFieldRule;
    expect(computedPayload(rule)).toEqual({ input: { kind: 'file', name: 'document_name' }, method: 'split', delimiter: '_', part: -3, stripExtension: true, transform: 'none' });
  });

  it('previews the file names once typing settles', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.method' }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.preview' }));
    fireEvent.change(screen.getByLabelText('mapping.computed.position'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('mapping.computed.fromEnd'));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(api.previewComputedField).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(api.previewComputedField).toHaveBeenCalledTimes(1);
    expect(api.previewComputedField).toHaveBeenCalledWith('model-1', { computed: expect.objectContaining({ part: -3 }), samples: [FILE] });
    expect(screen.getByText('2023')).toBeTruthy();
  });

  it('previews the files ticked, the first few by default', async () => {
    const files = Array.from({ length: 7 }, (_, index) => `F${index + 1}_2023.pdf`);
    render(<Harness files={files} />);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(api.previewComputedField).toHaveBeenLastCalledWith('model-1', expect.objectContaining({ samples: files.slice(0, 5) }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.preview' }));
    const boxes = screen.getAllByRole('checkbox', { name: 'mapping.computed.fileFor' });
    expect(boxes).toHaveLength(7);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[6]);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(api.previewComputedField).toHaveBeenLastCalledWith('model-1', expect.objectContaining({ samples: [...files.slice(1, 5), files[6]] }));
  });

  it('shapes the cut value with the reading rules steps', () => {
    const onRule = vi.fn();
    render(<Harness onRule={onRule} />);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.take.keep' }));
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.take.mode.end' }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.pattern' }));
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.preset.number' }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.transform' }));
    expect(screen.getByRole('radio', { name: 'mapping.rules.transformOption.year' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.transformOption.no_spaces' }));
    const payload = computedPayload(onRule.mock.calls.at(-1)![0] as ComputedFieldRule);
    expect(payload.take).toMatchObject({ from: 'end', unit: 'characters' });
    expect(payload.valuePattern).toBeTruthy();
    expect(payload.pattern).toBeUndefined();
    expect(payload.transform).toBe('no_spaces');
  });

  it('shows the runtime refusal inline', async () => {
    api.previewComputedField.mockRejectedValue({ response: { status: 422, data: { detail: 'pattern needs a group' } } });
    render(<Harness />);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(screen.getByRole('alert').textContent).toBeTruthy();
  });

  it('asks for the missing settings of each method', () => {
    expect(computedProblem({ ...newComputedRule(), delimiter: '' })).toBe('mapping.computed.problem.delimiter');
    expect(computedProblem({ ...newComputedRule(), part: 0 })).toBe('mapping.computed.problem.part');
    expect(computedProblem({ input: { kind: 'file', name: 'document_name' }, method: 'between' })).toBe('mapping.computed.problem.between');
    expect(computedProblem({ input: { kind: 'file', name: 'document_name' }, method: 'regex', pattern: '\\d{4}' })).toBe('mapping.computed.problem.group');
    expect(computedProblem({ input: { kind: 'field', name: 'gone' }, method: 'between', after: 'x' }, ['title'])).toBe('mapping.computed.problem.input');
    expect(computedProblem({ input: { kind: 'file', name: 'document_name' }, method: 'regex', pattern: '(?<year>\\d{4})' })).toBeNull();
  });
});

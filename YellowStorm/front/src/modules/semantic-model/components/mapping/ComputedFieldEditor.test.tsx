import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputedFieldRule } from '../../types';
import { ComputedFieldEditor, computedPayload, computedProblem, newComputedRule } from './ComputedFieldEditor';

const api = vi.hoisted(() => ({ previewComputedField: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));

const FILE = 'JOHNSON_JOHNSON_2023_8K_dated-2023-08-23.pdf';

function Harness({ onRule }: Readonly<{ onRule?: (rule: ComputedFieldRule) => void }>) {
  const [rule, setRule] = useState(newComputedRule());
  return <ComputedFieldEditor modelId='model-1' fieldLabel='Fiscal year' rule={rule} fields={[{ key: 'title', label: 'Title' }]} fileSamples={[FILE]}
    onChange={(next) => { setRule(next); onRule?.(next); }} />;
}

describe('ComputedFieldEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.previewComputedField.mockReset().mockResolvedValue({ results: [{ input: FILE, value: '2023', reason: 'found' }] });
  });
  afterEach(() => vi.useRealTimers());

  it('renders the simple methods and keeps the pattern behind Advanced', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'mapping.computed.methods.split' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'mapping.computed.methods.between' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'mapping.computed.methods.regex' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.computed.showAdvanced' }));
    expect(screen.getByRole('tab', { name: 'mapping.computed.methods.regex' })).toBeTruthy();
  });

  it('builds a split-from-the-end payload', () => {
    const onRule = vi.fn();
    render(<Harness onRule={onRule} />);
    fireEvent.change(screen.getByLabelText('mapping.computed.position'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('mapping.computed.fromEnd'));
    const rule = onRule.mock.calls.at(-1)![0] as ComputedFieldRule;
    expect(computedPayload(rule)).toEqual({ input: { kind: 'file', name: 'document_name' }, method: 'split', delimiter: '_', part: -3, stripExtension: true, transform: 'none' });
  });

  it('previews the file names once typing settles', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('mapping.computed.position'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('mapping.computed.fromEnd'));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(api.previewComputedField).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(api.previewComputedField).toHaveBeenCalledTimes(1);
    expect(api.previewComputedField).toHaveBeenCalledWith('model-1', { computed: expect.objectContaining({ part: -3 }), samples: [FILE] });
    expect(screen.getByText('2023')).toBeTruthy();
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

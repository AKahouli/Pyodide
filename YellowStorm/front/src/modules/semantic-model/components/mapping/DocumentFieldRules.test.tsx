import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SourceFieldMapping } from '../../types';
import { AiLimitsEditor, FieldReadingResult, FieldRulesEditor, limitProblem, patternProblem, ReadAllFieldsBar, withConceptFields } from './DocumentFieldRules';

const field = (key: string, extractionStrategy?: SourceFieldMapping['extractionStrategy']): SourceFieldMapping =>
  ({ sourceField: null, targetAttribute: key, mode: 'extract', extractionStrategy });

describe('DocumentFieldRules', () => {
  it('reads every extracted field the same way with one click', () => {
    const onApply = vi.fn();
    render(<ReadAllFieldsBar mappings={[field('a', 'deterministic'), field('b', 'ai')]} onApply={onApply} />);
    expect(screen.getByText('mapping.readAll.mixed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mapping\.strategy\.rules_then_ai/ }));
    expect(onApply).toHaveBeenCalledWith('rules_then_ai');
  });

  it('shows which method all fields share', () => {
    render(<ReadAllFieldsBar mappings={[field('a', 'ai'), field('b', 'ai')]} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /mapping\.strategy\.ai$/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds the labels a value follows, and stores no rules when nothing is set', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FieldRulesEditor fieldLabel='Contract number' onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    const input = screen.getByPlaceholderText('Contract number');
    fireEvent.change(input, { target: { value: 'N° de contrat' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ labels: ['N° de contrat'] });
    rerender(<FieldRulesEditor fieldLabel='Contract number' rules={{ labels: ['N° de contrat'] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.removeLabel' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('says a pattern is required to read anywhere, and when a pattern is broken', () => {
    render(<FieldRulesEditor fieldLabel='Number' rules={{ location: 'anywhere' }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('mapping.rules.patternRequired');
    expect(patternProblem('CNT-(')).toBeTruthy();
    expect(patternProblem(String.raw`CNT-\d+`)).toBeNull();
  });

  it('keeps only the AI limits changed for this source', () => {
    const onChange = vi.fn();
    render(<AiLimitsEditor defaults={{ maxBlocks: 400, maxCharacters: 60000, longDocumentCharacters: 30000, blocksPerField: 8 }} value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.ai\.title/ }));
    fireEvent.change(screen.getByLabelText('mapping.ai.blocksPerField'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ blocksPerField: 3 });
    expect(limitProblem({ blocksPerField: 3 })).toBeUndefined();
    expect(limitProblem({ maxBlocks: 900 })).toBeTruthy();
  });

  it('adds a concept field the saved mapping does not have, read like most other fields', () => {
    const saved = [field('number', 'ai'), field('title', 'ai'), field('date', 'deterministic'), { ...field('old'), mode: 'ignore' as const, extractionStrategy: undefined }];
    const { mappings, added } = withConceptFields(saved, [{ key: 'number' }, { key: 'customer_name' }, { key: 'title' }, { key: 'date' }, { key: 'old' }]);
    expect(added).toEqual(['customer_name']);
    expect(mappings.map((mapping) => mapping.targetAttribute)).toEqual(['number', 'customer_name', 'title', 'date', 'old']);
    expect(mappings[1]).toEqual({ sourceField: null, targetAttribute: 'customer_name', mode: 'extract', extractionStrategy: 'ai' });
    // A field left out on purpose stays left out.
    expect(mappings[4].mode).toBe('ignore');
  });

  it('drops a row for a field the concept no longer has', () => {
    const { mappings, added } = withConceptFields([field('number', 'ai'), field('gone', 'ai')], [{ key: 'number' }]);
    expect(added).toEqual([]);
    expect(mappings.map((mapping) => mapping.targetAttribute)).toEqual(['number']);
  });

  it('says why a field was not found and what to try', () => {
    render(<FieldReadingResult fieldLabel='Title' reading={{ method: 'ai', reason: 'ai_not_found', rules: { method: 'rules', reason: 'label_not_found' } }} />);
    expect(screen.getByText('mapping.reading.reason.ai_not_found')).toBeInTheDocument();
    expect(screen.getByText('mapping.reading.rulesFirst')).toBeInTheDocument();
    expect(screen.getByText('mapping.reading.hint.ai_not_found')).toBeInTheDocument();
  });

  it('shows a found value with the text it came from', () => {
    const onOpenQuote = vi.fn();
    render(<FieldReadingResult fieldLabel='Number' reading={{ method: 'rules', reason: 'found', value: 'CNT-1', page: 2, quote: 'Contract number CNT-1' }} onOpenQuote={onOpenQuote} />);
    expect(screen.getByText('CNT-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Contract number CNT-1/ }));
    expect(onOpenQuote).toHaveBeenCalledWith('Contract number CNT-1', 2);
  });
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceFieldMapping } from '../../types';
import { AiLimitsEditor, FieldReadingResult, FieldRulesEditor, limitProblem, pagesProblem, patternProblem, ReadAllFieldsBar, rulesProblem, withConceptFields, type LabelSuggestions } from './DocumentFieldRules';

const field = (key: string, extractionStrategy?: SourceFieldMapping['extractionStrategy']): SourceFieldMapping =>
  ({ sourceField: null, targetAttribute: key, mode: 'extract', extractionStrategy });

describe('DocumentFieldRules', () => {
  // The open rule steps are remembered in the browser: these tests start with all of them open.
  beforeEach(() => localStorage.setItem('semantic-model.rule-sections', JSON.stringify(['labels', 'where', 'keep', 'pattern', 'transform', 'options'])));

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

  it('reads all the text after a label up to optional "Stop at" labels', () => {
    const onChange = vi.fn();
    render(<FieldRulesEditor fieldLabel='Scope' rules={{ labels: ['Scope'], location: 'after_label' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.getByText('mapping.rules.boundaryHelp.after_label')).toBeInTheDocument();
    const input = screen.getByLabelText('mapping.rules.boundary.after_label');
    fireEvent.change(input, { target: { value: 'Duration' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ labels: ['Scope'], location: 'after_label', boundaryLabels: ['Duration'] });
  });

  it('drops the boundaries when another place is chosen', () => {
    const onChange = vi.fn();
    render(<FieldRulesEditor fieldLabel='Scope' rules={{ labels: ['Scope'], location: 'before_label', boundaryLabels: ['Intro'] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.getByLabelText('mapping.rules.boundary.before_label')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.tile.same_line' }));
    expect(onChange).toHaveBeenLastCalledWith({ labels: ['Scope'], location: 'same_line' });
  });

  it('reads whole pages, without labels, and says when the pages are wrong', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FieldRulesEditor fieldLabel='Annex' rules={{ location: 'pages', pages: { from: 3 } }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.queryByText('mapping.rules.labels')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('mapping.rules.pagesToFor'), { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith({ location: 'pages', pages: { from: 3, to: 5 } });
    rerender(<FieldRulesEditor fieldLabel='Annex' rules={{ location: 'pages', pages: { from: 5, to: 3 } }} onChange={onChange} />);
    expect(screen.getByRole('alert')).toHaveTextContent('mapping.rules.pagesOrder');
    expect(pagesProblem({ from: 1, to: 51 })).toBe('mapping.rules.pagesSpan');
    expect(pagesProblem({ from: 0 })).toBe('mapping.rules.pagesFromRequired');
    expect(pagesProblem({ from: 2001 })).toBe('mapping.rules.pagesRange');
    expect(pagesProblem({ from: 1, to: 50 })).toBeNull();
    expect(rulesProblem({ location: 'pages', pages: { from: 4, to: 2 } })).toBe(true);
    expect(rulesProblem({ location: 'after_label', boundaryLabels: ['End'] })).toBe(false);
  });

  it('starts whole pages at page 1', () => {
    const onChange = vi.fn();
    render(<FieldRulesEditor fieldLabel='Annex' onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.tile.pages' }));
    expect(onChange).toHaveBeenLastCalledWith({ location: 'pages', pages: { from: 1 } });
  });

  it('offers trimming both ends right after keeping the value as written, then removing every space', () => {
    localStorage.clear();
    const onChange = vi.fn();
    render(<FieldRulesEditor fieldLabel='Party' onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.queryByRole('radiogroup', { name: 'mapping.rules.transformFor' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.transform' }));
    const cleanUp = screen.getByRole('radiogroup', { name: 'mapping.rules.transformFor' });
    const options = within(cleanUp).getAllByRole('radio').map((option) => option.getAttribute('aria-label'));
    expect(options.slice(0, 3)).toEqual(['mapping.rules.transformOption.none', 'mapping.rules.transformOption.trim', 'mapping.rules.transformOption.no_spaces']);
    fireEvent.click(within(cleanUp).getByRole('radio', { name: 'mapping.rules.transformOption.trim' }));
    expect(onChange).toHaveBeenLastCalledWith({ transform: 'trim' });
  });

  it('keeps the custom pattern box open while it is empty', () => {
    localStorage.clear();
    render(<FieldRulesEditor fieldLabel='Number' onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.pattern' }));
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.preset.custom' }));
    expect(screen.getByRole('textbox', { name: 'mapping.rules.patternText' })).toBeInTheDocument();
  });

  it('folds every rule step to its setting, keeps a step with a problem open and remembers what is open', () => {
    localStorage.clear();
    const { unmount } = render(<FieldRulesEditor fieldLabel='Number' rules={{ location: 'anywhere', transform: 'upper' }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    for (const step of ['mapping.rules.labels', 'mapping.rules.location', 'mapping.rules.take.keep', 'mapping.rules.options']) {
      expect(screen.getByRole('button', { name: step })).toHaveAttribute('aria-expanded', 'false');
    }
    const cleanUp = screen.getByRole('button', { name: 'mapping.rules.transform' });
    expect(cleanUp).toHaveAttribute('aria-expanded', 'false');
    expect(cleanUp).toHaveAccessibleDescription('mapping.rules.transformOption.upper');
    // Reading anywhere needs a pattern: that step cannot be folded away.
    expect(screen.getByRole('button', { name: 'mapping.rules.pattern' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(cleanUp);
    expect(screen.getByRole('radiogroup', { name: 'mapping.rules.transformFor' })).toBeInTheDocument();
    unmount();
    render(<FieldRulesEditor fieldLabel='Other' onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.getByRole('button', { name: 'mapping.rules.transform' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('puts the help behind an info button', () => {
    render(<FieldRulesEditor fieldLabel='Number' onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.getByRole('button', { name: 'mapping.rules.labelsHelp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'mapping.rules.whereHelp.auto' })).toBeInTheDocument();
  });

  describe('labels found in the documents', () => {
    const suggestion = (label: string, documents = 3, kind: 'heading' | 'label' = 'label') => ({ label, kind, documents, page: 2, example: `${label}: x` });
    const suggestions = (labels: ReturnType<typeof suggestion>[], extra: Partial<LabelSuggestions> = {}): LabelSuggestions =>
      ({ status: 'ready', labels, documentsRead: 4, ...extra });
    const open = () => fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));

    it('adds a suggestion, hides those already added and shows where one is on hover', () => {
      const onChange = vi.fn();
      const onPreview = vi.fn();
      render(<FieldRulesEditor fieldLabel='Number' rules={{ labels: ['Contract No.'] }} onChange={onChange}
        suggestions={suggestions([suggestion('Contract No.'), suggestion('Reference', 2)], { onPreview })} />);
      open();
      const chips = screen.getAllByRole('button', { name: 'mapping.suggestions.add' });
      expect(chips).toHaveLength(1);
      expect(chips[0]).toHaveTextContent('Reference');
      expect(chips[0]).toHaveTextContent('2/4');
      fireEvent.mouseEnter(chips[0]);
      expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ label: 'Reference', page: 2 }));
      fireEvent.click(chips[0]);
      expect(onChange).toHaveBeenLastCalledWith({ labels: ['Contract No.', 'Reference'] });
    });

    it('shows the top suggestions, then all of them, with a filter', () => {
      render(<FieldRulesEditor fieldLabel='Number' onChange={vi.fn()}
        suggestions={suggestions(Array.from({ length: 15 }, (_, index) => suggestion(`Label ${index + 1}`)))} />);
      open();
      expect(screen.getAllByRole('button', { name: 'mapping.suggestions.add' })).toHaveLength(12);
      fireEvent.click(screen.getByRole('button', { name: 'mapping.suggestions.showAll' }));
      expect(screen.getAllByRole('button', { name: 'mapping.suggestions.add' })).toHaveLength(15);
      fireEvent.change(screen.getByRole('textbox', { name: 'mapping.suggestions.filter' }), { target: { value: 'label 1' } });
      // Label 1, and 10 to 15.
      expect(screen.getAllByRole('button', { name: 'mapping.suggestions.add' })).toHaveLength(7);
    });

    it('cannot add more than 10 labels', () => {
      const labels = Array.from({ length: 10 }, (_, index) => `Own ${index}`);
      render(<FieldRulesEditor fieldLabel='Number' rules={{ labels }} onChange={vi.fn()} suggestions={suggestions([suggestion('Reference')])} />);
      open();
      expect(screen.getByRole('button', { name: 'mapping.suggestions.add' })).toBeDisabled();
      expect(screen.getByText('mapping.suggestions.full')).toBeInTheDocument();
    });

    it('suggests reading the whole section when a heading is picked', () => {
      const onChange = vi.fn();
      const { rerender } = render(<FieldRulesEditor fieldLabel='Scope' onChange={onChange} suggestions={suggestions([suggestion('Purpose', 4, 'heading')])} />);
      open();
      fireEvent.click(screen.getByRole('button', { name: 'mapping.suggestions.add' }));
      expect(onChange).toHaveBeenLastCalledWith({ labels: ['Purpose'] });
      rerender(<FieldRulesEditor fieldLabel='Scope' rules={{ labels: ['Purpose'] }} onChange={onChange} suggestions={suggestions([suggestion('Purpose', 4, 'heading')])} />);
      expect(screen.getByText('mapping.rules.headingHint')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.headingHintUse' }));
      expect(onChange).toHaveBeenLastCalledWith({ labels: ['Purpose'], location: 'after_label' });
    });

    it('shows loading, error and empty states', () => {
      const onRetry = vi.fn();
      const { rerender } = render(<FieldRulesEditor fieldLabel='Number' onChange={vi.fn()} suggestions={suggestions([], { status: 'loading' })} />);
      open();
      expect(screen.getByLabelText('mapping.suggestions.loading')).toBeInTheDocument();
      rerender(<FieldRulesEditor fieldLabel='Number' onChange={vi.fn()} suggestions={suggestions([], { status: 'error', onRetry })} />);
      fireEvent.click(screen.getByRole('button', { name: /action\.retry/ }));
      expect(onRetry).toHaveBeenCalled();
      rerender(<FieldRulesEditor fieldLabel='Number' onChange={vi.fn()} suggestions={suggestions([])} />);
      expect(screen.getByText('mapping.suggestions.empty')).toBeInTheDocument();
    });
  });
});

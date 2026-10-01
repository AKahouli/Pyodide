import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentFieldReading, ExtractionTake } from '../../types';
import { FieldRulesEditor } from './DocumentFieldRules';
import { ChoiceGroup } from './RuleControls';
import { countForCut, keptRange, patternMatches, unitSpans, ValueShaper } from './ValueShaper';

const raw = 'alpha beta gamma\nsecond line\nthird';
const found = (value: string): DocumentFieldReading => ({ method: 'rules', reason: 'found', value, raw });

/** Puts the caret, or a selection, on characters of the raw text box, as a click or a drag would. */
function select(start: number, end = start) {
  const box = screen.getByTestId('shaper-text');
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const at = (offset: number): [Text, number] => {
    let seen = 0;
    for (const node of nodes) {
      if (offset <= seen + node.length) return [node, offset - seen];
      seen += node.length;
    }
    return [nodes.at(-1)!, nodes.at(-1)!.length];
  };
  const range = document.createRange();
  range.setStart(...at(start));
  range.setEnd(...at(end));
  const selection = globalThis.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(box);
}

describe('cutting the text found', () => {
  it('splits it into characters, words and lines', () => {
    expect(unitSpans('ab c', 'characters')).toHaveLength(4);
    expect(unitSpans(raw, 'words')).toEqual([[0, 5], [6, 10], [11, 16], [17, 23], [24, 28], [29, 34]]);
    expect(unitSpans(raw, 'lines')).toEqual([[0, 16], [17, 28], [29, 34]]);
  });

  it('keeps the first or last units', () => {
    expect(keptRange(raw)).toEqual([0, raw.length]);
    expect(raw.slice(...keptRange(raw, { from: 'start', count: 3, unit: 'characters' }))).toBe('alp');
    expect(raw.slice(...keptRange(raw, { from: 'end', count: 3, unit: 'characters' }))).toBe('ird');
    expect(raw.slice(...keptRange(raw, { from: 'start', count: 2, unit: 'words' }))).toBe('alpha beta');
    expect(raw.slice(...keptRange(raw, { from: 'end', count: 2, unit: 'words' }))).toBe('line\nthird');
    expect(raw.slice(...keptRange(raw, { from: 'start', count: 1, unit: 'lines' }))).toBe('alpha beta gamma');
    expect(raw.slice(...keptRange(raw, { from: 'end', count: 2, unit: 'lines' }))).toBe('second line\nthird');
    // Asking for more than there is keeps everything.
    expect(keptRange(raw, { from: 'start', count: 99, unit: 'lines' })).toEqual([0, raw.length]);
  });

  it('turns a cut at a character into a count', () => {
    // Inside "beta": from the start it keeps alpha and beta, from the end beta and what follows.
    expect(countForCut(raw, 8, 'start', 'words')).toBe(2);
    expect(countForCut(raw, 8, 'end', 'words')).toBe(5);
    expect(countForCut(raw, 3, 'start', 'characters')).toBe(3);
    expect(countForCut(raw, 20, 'start', 'lines')).toBe(2);
    expect(countForCut(raw, 0, 'start', 'words')).toBe(1);
  });

  it('finds pattern matches, and none for a broken pattern', () => {
    expect(patternMatches('CNT-12 and CNT-7', String.raw`CNT-\d+`)).toEqual([[0, 6], [11, 16]]);
    expect(patternMatches('abc', '(')).toEqual([]);
  });
});

describe('ValueShaper', () => {
  const renderShaper = (take?: ExtractionTake, extra: Partial<Parameters<typeof ValueShaper>[0]> = {}) => {
    const onTake = vi.fn();
    const onAction = vi.fn();
    render(<ValueShaper fieldLabel='Scope' reading={found('alpha beta')} location='after_label' take={take} onTake={onTake} onAction={onAction} {...extra} />);
    return { onTake, onAction };
  };

  it('highlights what is kept and shows the result', () => {
    renderShaper({ from: 'start', count: 2, unit: 'words' });
    const box = screen.getByTestId('shaper-text');
    expect(box.textContent).toBe(raw);
    expect(within(box).getByText('alpha beta')).toHaveClass('bg-primary/15');
    expect(screen.getByText('mapping.rules.take.result').parentElement).toHaveTextContent('alpha beta');
  });

  it('keeps the beginning, the end or everything', () => {
    const { onTake } = renderShaper();
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.take.mode.start' }));
    expect(onTake).toHaveBeenLastCalledWith({ from: 'start', count: 17, unit: 'characters' });
  });

  it('cuts where the text is clicked', () => {
    const { onTake } = renderShaper({ from: 'start', count: 1, unit: 'words' });
    select(13);
    expect(onTake).toHaveBeenLastCalledWith({ from: 'start', count: 3, unit: 'words' });
  });

  it('moves the handle with the arrow keys, by ten with Shift', () => {
    const { onTake } = renderShaper({ from: 'start', count: 12, unit: 'characters' });
    const handle = screen.getByRole('slider', { name: 'mapping.rules.take.handle' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onTake).toHaveBeenLastCalledWith({ from: 'start', count: 13, unit: 'characters' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(onTake).toHaveBeenLastCalledWith({ from: 'start', count: 2, unit: 'characters' });
  });

  it('syncs the number and the slider', () => {
    const { onTake } = renderShaper({ from: 'end', count: 2, unit: 'lines' });
    expect(screen.getByRole('slider', { name: 'mapping.rules.take.slider' })).toHaveAttribute('max', '3');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'mapping.rules.take.count' }), { target: { value: '1' } });
    expect(onTake).toHaveBeenLastCalledWith({ from: 'end', count: 1, unit: 'lines' });
  });

  it('offers the selected text as a boundary, a label or a length', () => {
    const { onTake, onAction } = renderShaper();
    select(6, 10);
    const bar = screen.getByRole('toolbar', { name: 'mapping.rules.take.selection' });
    expect(within(bar).queryByRole('button', { name: 'mapping.rules.take.startAfter' })).not.toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'mapping.rules.take.stopAt' }));
    expect(onAction).toHaveBeenCalledWith('stop_at', 'beta');
    select(0, 10);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.take\.useAsLabel/ }));
    expect(onAction).toHaveBeenLastCalledWith('label', 'alpha beta');
    select(0, 10);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.take\.keepLength/ }));
    expect(onTake).toHaveBeenLastCalledWith({ from: 'start', count: 10, unit: 'characters' });
  });

  it('asks to read a document when there is no text yet', () => {
    const onRead = vi.fn();
    render(<ValueShaper fieldLabel='Scope' location='auto' onTake={vi.fn()} onAction={vi.fn()} onRead={onRead} />);
    expect(screen.getByText('mapping.rules.take.placeholder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.live.readNow' }));
    expect(onRead).toHaveBeenCalled();
  });
});

describe('graphical rule controls', () => {
  it('moves the choice with the arrow keys in a radio group', () => {
    const onChange = vi.fn();
    render(<ChoiceGroup variant='tiles' label='Where' value='b' onChange={onChange}
      options={['a', 'b', 'c', 'd', 'e'].map((value) => ({ value, label: value.toUpperCase() }))} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(radios[1], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    // Tiles are three a row: down moves to the one below.
    fireEvent.keyDown(radios[1], { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('e');
    fireEvent.keyDown(radios[1], { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('picks the place, the pattern and the clean-up with tiles and chips', () => {
    const onChange = vi.fn();
    render(<FieldRulesEditor fieldLabel='Scope' onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.getAllByRole('radio', { name: /mapping\.rules\.tile\./ })).toHaveLength(9);
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.tile.after_label' }));
    expect(onChange).toHaveBeenLastCalledWith({ location: 'after_label' });
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.preset.date' }));
    expect(onChange).toHaveBeenLastCalledWith({ pattern: expect.any(String) });
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.occurrenceOption.first' }));
    expect(onChange).toHaveBeenLastCalledWith({ occurrence: 'first' });
  });

  it('keeps a part of the value, says so in the summary, and turns a selection into a boundary', () => {
    const onChange = vi.fn();
    const rules = { labels: ['Scope'], location: 'after_label' as const, take: { from: 'start' as const, count: 10, unit: 'characters' as const } };
    render(<FieldRulesEditor fieldLabel='Scope' rules={rules} onChange={onChange} live={{ reading: found('alpha beta'), pending: false }} />);
    expect(screen.getByRole('button', { name: /mapping\.rules\.title/ })).toHaveTextContent('mapping.rules.summaryTake.start');
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    select(11, 16);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.take.stopAt' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...rules, boundaryLabels: ['gamma'] });
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.take.mode.all' }));
    expect(onChange).toHaveBeenLastCalledWith({ labels: ['Scope'], location: 'after_label' });
  });

  it('chooses whole pages on a strip sized by the document', () => {
    const onChange = vi.fn();
    render(<FieldRulesEditor fieldLabel='Annex' rules={{ location: 'pages', pages: { from: 2 } }} onChange={onChange} pageCount={6} />);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.rules\.title/ }));
    expect(screen.getByText('mapping.rules.pagesOf')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'mapping.rules.stepUp' })[0]);
    expect(onChange).toHaveBeenLastCalledWith({ location: 'pages', pages: { from: 3 } });
  });
});

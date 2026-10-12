import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cleanFieldGraph, withGraph } from '../../graphSettings';
import type { AttributeDefinition } from '../../types';
import { FieldGraphPane } from './FieldGraphPane';

const body: AttributeDefinition = { key: 'corps', label: 'Corps', type: 'text', required: false };

describe('FieldGraphPane', () => {
  it('shows a field in the graph by default and says hidden fields stay searchable and in the records', () => {
    render(<FieldGraphPane attribute={body} onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'attributes.graph.switchFor' })).toBeChecked();
    expect(screen.getByText('attributes.graph.hint')).toBeInTheDocument();
  });

  it('hides a field with the switch, and stores nothing again once it is shown', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FieldGraphPane attribute={body} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'attributes.graph.switchFor' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...body, graph: { expose: false } });
    const hidden = { ...body, graph: { expose: false } };
    rerender(<FieldGraphPane attribute={hidden} onChange={onChange} />);
    expect(screen.getByRole('switch', { name: 'attributes.graph.switchFor' })).not.toBeChecked();
    // A hidden field is not cut: the length limit is for fields that stay.
    expect(screen.queryByLabelText('attributes.graph.maxChars')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'attributes.graph.switchFor' }));
    expect(onChange).toHaveBeenLastCalledWith(body);
  });

  it('limits a long text in the graph, within what the server accepts', () => {
    const onChange = vi.fn();
    render(<FieldGraphPane attribute={body} onChange={onChange} />);
    const input = screen.getByLabelText('attributes.graph.maxChars');
    fireEvent.change(input, { target: { value: '300' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith({ ...body, graph: { maxChars: 300 } });
    onChange.mockClear();
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(body);
  });

  it('offers no length limit for a field that is not text, and nothing when it cannot be edited', () => {
    const { rerender } = render(<FieldGraphPane attribute={{ ...body, type: 'number' }} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('attributes.graph.maxChars')).not.toBeInTheDocument();
    rerender(<FieldGraphPane attribute={body} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('switch', { name: 'attributes.graph.switchFor' })).toBeDisabled();
  });
});

describe('graph settings', () => {
  it('keeps only what is not default', () => {
    expect(cleanFieldGraph({ expose: true })).toBeUndefined();
    expect(cleanFieldGraph({ expose: false, maxChars: 100 })).toEqual({ expose: false, maxChars: 100 });
    expect(withGraph({ ...body, graph: { expose: false } }, { expose: undefined })).toEqual(body);
  });
});

import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { encodeNativeInput, NativeInputFields } from './NativeInputFields';
import { nativeInputSummary } from './native-input-presentation';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('Native enum input', () => {
  it('keeps an empty required enum invalid', () => {
    render(<NativeInputFields schema={{ type: 'string', enum: [] }} value='' onChange={vi.fn()} label='Unavailable choice' required />);
    expect(screen.getByRole('combobox')).toBeInvalid();
  });
  it('uses a compact field for short answers and multiline for explicit long text', () => {
    const view = render(<NativeInputFields schema={{ type: 'string' }} value='' onChange={vi.fn()} label='Answer' />);
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
    view.rerender(<NativeInputFields schema={{ type: 'string', maxLength: 2000 }} value='' onChange={vi.fn()} label='Data' />);
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });
  it('uses readable labels and editable suggestions without silently selecting one', () => {
    const changed = vi.fn();
    render(<NativeInputFields schema={{ type: 'string', title: 'Chart interval', description: 'Daily is a useful starting point.',
      examples: ['Daily', '4-hour'] }} value='' onChange={changed} label='chart_interval' required />);
    const field = screen.getByRole('textbox', { name: /Chart interval/ });
    expect(field).toHaveValue('');
    expect(screen.queryByText('chart_interval')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '4-hour' }));
    expect(changed).toHaveBeenCalledWith('4-hour');
    fireEvent.change(field, { target: { value: 'Weekly' } });
    expect(changed).toHaveBeenCalledWith('Weekly');
  });
  it('formats a human transcript without changing JSON-looking literal values', () => {
    expect(nativeInputSummary({ chart_interval: '4h', notes: 'true' }, { type: 'object', properties: {
      chart_interval: { type: 'string', title: 'Chart interval' }, notes: { type: 'string' },
    } })).toBe('Chart interval: 4h\nnotes: true');
  });
  it('requires an explicit choice instead of visually selecting the first option', () => {
    const submitted = vi.fn();
    function Form() {
      const [value, setValue] = useState<unknown>('');
      return <form onSubmit={(event) => { event.preventDefault(); submitted(encodeNativeInput(value)); }}>
        <NativeInputFields schema={{ type: 'string', enum: ['ocean', 'forest'] }}
          value={value} onChange={setValue} label='Setting' required />
        <button type='submit'>Submit</button>
      </form>;
    }
    render(<Form />);
    const choice = screen.getByRole('radio', { name: 'forest' });
    expect(choice).not.toBeChecked();
    expect(choice).toBeInvalid();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(submitted).not.toHaveBeenCalled();
    fireEvent.click(choice);
    expect(choice).toBeChecked();
    expect(choice).toBeValid();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(submitted).toHaveBeenCalledWith({ result: '"forest"' });
  });
});

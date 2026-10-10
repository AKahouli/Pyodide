import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { encodeNativeInput, NativeInputFields } from './NativeInputFields';
import { nativeInputSummary } from './native-input-presentation';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('Native enum input', () => {
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
    const select = screen.getByRole('combobox', { name: 'Setting' });
    expect(select).toHaveValue('');
    expect(select).toHaveDisplayValue('rootInput.select');
    expect(select).toBeInvalid();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(submitted).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: JSON.stringify('forest') } });
    expect(select).toHaveDisplayValue('forest');
    expect(select).toBeValid();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(submitted).toHaveBeenCalledWith({ result: '"forest"' });
  });
});

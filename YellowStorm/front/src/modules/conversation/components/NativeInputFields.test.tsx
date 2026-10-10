import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { encodeNativeInput, NativeInputFields } from './NativeInputFields';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('Native enum input', () => {
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

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';
import { IconPickerPreview } from './IconDisplay';

vi.mock('react-icons/fa', () => ({ FaGithub: () => <svg aria-hidden='true' /> }));

describe('connector branding guidance', () => {
  it('names native and hex color inputs and explains both on focus without changing values', async () => {
    const onChange = vi.fn();
    render(<ColorPicker value='#24292e' onChange={onChange} />);
    const native = screen.getByLabelText('connectors.form.fields.color.label');
    const hex = screen.getByRole('textbox', { name: 'connectors.help.color' });
    expect(native).toHaveAttribute('type', 'color');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => native.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('connectors.help.color');
    expect(native).toHaveAccessibleDescription('connectors.help.color');
    act(() => hex.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('connectors.help.color');
    fireEvent.change(native, { target: { value: '#123456' } });
    expect(onChange).toHaveBeenLastCalledWith('#123456');
    fireEvent.change(hex, { target: { value: '#abcdef' } });
    expect(onChange).toHaveBeenLastCalledWith('#abcdef');
  });

  it('explains icon contrast on keyboard focus and clearing on pointer hover, with working actions', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const onToggle = vi.fn();
    render(<IconPickerPreview icon='FaGithub' color='#24292e' onClear={onClear} onToggleColorMode={onToggle} />);
    const mode = await screen.findByRole('button', { name: 'connectors.help.iconMode' });
    act(() => mode.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('connectors.help.iconMode');
    await user.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledOnce();
    const clear = screen.getByRole('button', { name: 'connectors.help.iconClear' });
    await user.hover(clear);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('connectors.help.iconClear');
    expect(clear).not.toHaveAttribute('title');
    await user.click(clear);
    expect(onClear).toHaveBeenCalledOnce();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsModalProvider, useSettingsModal } from './SettingsContext';

function Consumer() {
  const { isOpen, activeSection, openSettings, closeSettings } = useSettingsModal();

  return (
    <div>
      <div>open-{String(isOpen)}</div>
      <div>section-{activeSection}</div>
      <button type="button" onClick={() => openSettings('sessions')}>open</button>
      <button type="button" onClick={closeSettings}>close</button>
    </div>
  );
}

describe('SettingsContext', () => {
  it('throws when used outside provider', () => {
    expect(() => render(<Consumer />)).toThrow('useSettingsModal must be used within a SettingsModalProvider');
  });

  it('opens and closes settings with section selection', () => {
    render(
      <SettingsModalProvider>
        <Consumer />
      </SettingsModalProvider>,
    );

    expect(screen.getByText('open-false')).toBeInTheDocument();
    expect(screen.getByText('section-profile')).toBeInTheDocument();

    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('open-true')).toBeInTheDocument();
    expect(screen.getByText('section-sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close'));
    expect(screen.getByText('open-false')).toBeInTheDocument();
  });
});

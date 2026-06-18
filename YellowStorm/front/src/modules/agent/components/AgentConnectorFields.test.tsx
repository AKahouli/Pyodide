import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentConnectorFields } from './AgentConnectorFields';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: ReactNode }) => <label>{children}</label>,
}));

vi.mock('@/components/ui/multi-select', () => ({
  MultiSelect: ({ value, onValueChange }: { value: string[]; onValueChange: (value: string[]) => void }) => (
    <button type="button" onClick={() => onValueChange(['connector-1'])}>
      connectors-{value.length}
    </button>
  ),
}));

vi.mock('@/components/ui/radio-group', () => ({
  RadioGroup: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <div>
      {children}
      <button type="button" onClick={() => onValueChange?.('selected')}>
        choose-selected
      </button>
    </div>
  ),
  RadioGroupItem: ({ value }: { value: string }) => <span data-value={value}>{value}</span>,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (value: boolean) => void }) => (
    <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange?.(e.target.checked)} />
  ),
}));

describe('AgentConnectorFields', () => {
  it('adds a selected-tools whitelist when switching modes', () => {
    const onSelectionsChange = vi.fn();

    render(
      <AgentConnectorFields
        availableConnectors={[
          {
            id: 'connector-1',
            name: 'Code Interpreter',
            description: 'Run code',
            connectedAppKey: '',
            actions: [
              { key: 'run_code', label: 'Run code', description: 'Run code', isEnabled: true },
              { key: 'upload_file', label: 'Upload file', description: 'Upload file', isEnabled: true },
            ],
          },
        ]}
        connectors={['connector-1']}
        connectorActionSelections={[]}
        onConnectorsChange={vi.fn()}
        onConnectorActionSelectionsChange={onSelectionsChange}
      />,
    );

    fireEvent.click(screen.getByText('choose-selected'));

    expect(onSelectionsChange).toHaveBeenCalledWith([
      { connectorId: 'connector-1', actionKeys: ['run_code', 'upload_file'] },
    ]);
  });

  it('does not clear the last selected tool', () => {
    const onSelectionsChange = vi.fn();

    render(
      <AgentConnectorFields
        availableConnectors={[
          {
            id: 'connector-1',
            name: 'Code Interpreter',
            description: 'Run code',
            connectedAppKey: '',
            actions: [
              { key: 'run_code', label: 'Run code', description: 'Run code', isEnabled: true },
            ],
          },
        ]}
        connectors={['connector-1']}
        connectorActionSelections={[{ connectorId: 'connector-1', actionKeys: ['run_code'] }]}
        onConnectorsChange={vi.fn()}
        onConnectorActionSelectionsChange={onSelectionsChange}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onSelectionsChange).not.toHaveBeenCalled();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogTransferDialog } from './CatalogTransferDialog';

const exportConnectorCatalog = vi.fn();
const importCatalog = vi.fn();

vi.mock('../api', () => ({
  exportConnectorCatalog: (...args: unknown[]) => exportConnectorCatalog(...args),
  exportSkillCatalog: vi.fn(),
  importCatalog: (...args: unknown[]) => importCatalog(...args),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key }),
}));

vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));

describe('CatalogTransferDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('exports selected connectors with encrypted security options', async () => {
    exportConnectorCatalog.mockResolvedValue(new Blob(['archive']));
    const user = userEvent.setup();
    render(
      <CatalogTransferDialog
        open
        onOpenChange={vi.fn()}
        mode='export'
        resource='connectors'
        selectedIds={['connector-id']}
        onImported={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText('catalogTransfer.includeSecurity'));
    await user.type(screen.getByLabelText('catalogTransfer.passphrase'), 'portable-passphrase');
    await user.click(screen.getByRole('button', { name: /catalogTransfer.exportAction/ }));

    expect(exportConnectorCatalog).toHaveBeenCalledWith({
      selection: 'selected',
      ids: ['connector-id'],
      includeSecurity: true,
      passphrase: 'portable-passphrase',
    });
  });

  it('imports an archive using the explicit overwrite policy', async () => {
    importCatalog.mockResolvedValue({
      skills: { created: 1, updated: 0, skipped: 0 },
      connectors: { created: 1, updated: 0, skipped: 0 },
      categories: { created: 0, reused: 0 },
      security: { credentials: 0, connectedApps: 0, tokens: 0 },
    });
    const onImported = vi.fn();
    const user = userEvent.setup();
    render(
      <CatalogTransferDialog
        open
        onOpenChange={vi.fn()}
        mode='import'
        resource='connectors'
        selectedIds={[]}
        onImported={onImported}
      />,
    );

    const file = new File(['{}'], 'catalog.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('catalogTransfer.archiveFile'), file);
    await user.click(screen.getByLabelText('catalogTransfer.overwriteExisting'));
    await user.click(screen.getByRole('button', { name: /catalogTransfer.importAction/ }));

    expect(importCatalog).toHaveBeenCalledWith(file, 'overwrite', undefined);
    expect(onImported).toHaveBeenCalled();
  });
});

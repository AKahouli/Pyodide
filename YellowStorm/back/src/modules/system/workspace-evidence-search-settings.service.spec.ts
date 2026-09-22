import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConnectorService } from '../connector/connector.service';
import { SYSTEM_SETTING_STORE, type SystemSettingRow, type SystemSettingStore } from './persistence/system-setting.store';
import { WorkspaceEvidenceSearchSettingsService } from './workspace-evidence-search-settings.service';

class InMemorySettingStore implements SystemSettingStore {
  private readonly rows = new Map<string, SystemSettingRow>();

  async get(key: string): Promise<SystemSettingRow | null> {
    return this.rows.get(key) ?? null;
  }

  async getMany(keys: string[]): Promise<SystemSettingRow[]> {
    return keys.flatMap((key) => (this.rows.has(key) ? [this.rows.get(key)!] : []));
  }

  async upsert(key: string, value: unknown): Promise<SystemSettingRow> {
    const row: SystemSettingRow = { key, value, updatedAt: new Date() };
    this.rows.set(key, row);
    return row;
  }

  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }

  seed(row: SystemSettingRow): void {
    this.rows.set(row.key, row);
  }
}

describe('WorkspaceEvidenceSearchSettingsService', () => {
  let service: WorkspaceEvidenceSearchSettingsService;
  let store: InMemorySettingStore;
  const connectorService = { findById: jest.fn(), findAll: jest.fn() };

  beforeEach(async () => {
    store = new InMemorySettingStore();
    connectorService.findById.mockReset();
    connectorService.findAll.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkspaceEvidenceSearchSettingsService,
        { provide: SYSTEM_SETTING_STORE, useValue: store },
        { provide: ConnectorService, useValue: connectorService },
      ],
    }).compile();
    service = moduleRef.get(WorkspaceEvidenceSearchSettingsService);
  });

  it('returns no connector when the global setting has not been configured', async () => {
    await expect(service.getSettings()).resolves.toMatchObject({ connectorId: null });
  });

  it('returns the persisted connector selection', async () => {
    store.seed({
      key: 'workspace_evidence_search',
      value: { connectorId: 'connector-1' },
      updatedAt: new Date('2026-07-13T00:00:00Z'),
    });

    await expect(service.getSettings()).resolves.toMatchObject({ connectorId: 'connector-1' });
  });

  it('persists an active connector without applying a connector-type filter', async () => {
    connectorService.findById.mockResolvedValue({ id: 'connector-1', isActive: true });

    await expect(service.updateSettings('connector-1')).resolves.toMatchObject({ connectorId: 'connector-1' });
    expect(connectorService.findById).toHaveBeenCalledWith('connector-1');
  });

  it('lists every active connector across pages as a safe selector option', async () => {
    connectorService.findAll
      .mockResolvedValueOnce({
        data: [{ id: 'connector-search', name: 'Logical search' }],
        meta: { totalPages: 2 },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'connector-drive', name: 'Drive search' }],
        meta: { totalPages: 2 },
      });

    await expect(service.listActiveConnectorOptions()).resolves.toEqual([
      { id: 'connector-search', name: 'Logical search' },
      { id: 'connector-drive', name: 'Drive search' },
    ]);
    expect(connectorService.findAll).toHaveBeenNthCalledWith(1, { page: 1, limit: 100, isActive: true });
    expect(connectorService.findAll).toHaveBeenNthCalledWith(2, { page: 2, limit: 100, isActive: true });
  });

  it('rejects an inactive connector', async () => {
    connectorService.findById.mockResolvedValue({ id: 'connector-1', isActive: false });

    await expect(service.updateSettings('connector-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows clearing the selection without reading a connector', async () => {
    await expect(service.updateSettings(null)).resolves.toMatchObject({ connectorId: null });
    expect(connectorService.findById).not.toHaveBeenCalled();
  });
});

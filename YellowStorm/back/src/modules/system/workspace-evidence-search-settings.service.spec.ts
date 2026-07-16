import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConnectorService } from '../connector/connector.service';
import { SystemSetting } from './schemas/system-setting.schema';
import { WorkspaceEvidenceSearchSettingsService } from './workspace-evidence-search-settings.service';

interface StoredSetting {
  key: string;
  value: { connectorId: string | null };
  updatedAt?: Date;
}

class InMemoryModel {
  private readonly store = new Map<string, StoredSetting>();

  findOne({ key }: { key: string }): { lean: () => { exec: () => Promise<StoredSetting | null> } } {
    return { lean: () => ({ exec: async () => this.store.get(key) ?? null }) };
  }

  findOneAndUpdate(
    filter: { key: string },
    update: { key: string; value: { connectorId: string | null } },
  ): { lean: () => { exec: () => Promise<StoredSetting> } } {
    const next = { key: filter.key, value: update.value, updatedAt: new Date() };
    this.store.set(filter.key, next);
    return { lean: () => ({ exec: async () => next }) };
  }

  seed(setting: StoredSetting): void {
    this.store.set(setting.key, setting);
  }
}

describe('WorkspaceEvidenceSearchSettingsService', () => {
  let service: WorkspaceEvidenceSearchSettingsService;
  let model: InMemoryModel;
  const connectorService = { findById: jest.fn(), findAll: jest.fn() };

  beforeEach(async () => {
    model = new InMemoryModel();
    connectorService.findById.mockReset();
    connectorService.findAll.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkspaceEvidenceSearchSettingsService,
        { provide: getModelToken(SystemSetting.name), useValue: model },
        { provide: ConnectorService, useValue: connectorService },
      ],
    }).compile();
    service = moduleRef.get(WorkspaceEvidenceSearchSettingsService);
  });

  it('returns no connector when the global setting has not been configured', async () => {
    await expect(service.getSettings()).resolves.toMatchObject({ connectorId: null });
  });

  it('returns the persisted connector selection', async () => {
    model.seed({
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

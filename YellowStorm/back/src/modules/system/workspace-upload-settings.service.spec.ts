import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WorkspaceUploadSettingsService } from './workspace-upload-settings.service';
import { LoggerService } from '../logger';
import { SYSTEM_SETTING_STORE, type SystemSettingRow, type SystemSettingStore } from './persistence/system-setting.store';
import {
  DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS,
  WORKSPACE_UPLOAD_SETTINGS_KEY,
} from './constants/workspace-upload-settings.constants';
import { EXTENSION_MIME_TYPES } from '../document/constants/mime-types.constant';

class InMemorySettingStore implements SystemSettingStore {
  private readonly rows = new Map<string, SystemSettingRow>();

  async get(key: string): Promise<SystemSettingRow | null> {
    return this.rows.get(key) ?? null;
  }

  async getMany(keys: string[]): Promise<SystemSettingRow[]> {
    return keys.flatMap((key) => (this.rows.has(key) ? [this.rows.get(key)!] : []));
  }

  async listAll(): Promise<SystemSettingRow[]> {
    return [];
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

const buildLogger = (): LoggerService =>
  ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  }) as unknown as LoggerService;

describe('WorkspaceUploadSettingsService', () => {
  let service: WorkspaceUploadSettingsService;
  let store: InMemorySettingStore;

  beforeEach(async () => {
    store = new InMemorySettingStore();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkspaceUploadSettingsService,
        { provide: SYSTEM_SETTING_STORE, useValue: store },
        { provide: LoggerService, useFactory: buildLogger },
      ],
    }).compile();
    service = moduleRef.get(WorkspaceUploadSettingsService);
  });

  it('seeds the default extension list when no document exists', async () => {
    await service.ensureDefaultSettings();
    const result = await service.getSettings();

    expect(result.allowedExtensions).toEqual([...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS]);
    expect(result.supportedExtensions).toContain('.css');
  });

  it('returns the stored list when present', async () => {
    store.seed({
      key: WORKSPACE_UPLOAD_SETTINGS_KEY,
      value: { allowedExtensions: ['.pdf', '.png'] },
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await service.onApplicationBootstrap();
    const result = await service.getSettings();
    expect(result.allowedExtensions).toEqual(['.pdf', '.png']);
    expect(result.supportedExtensions).toContain('.pdf');
  });

  it('normalizes, dedupes, and persists updates; logs rejections', async () => {
    await service.ensureDefaultSettings();
    const result = await service.updateSettings(
      ['PDF', '.pdf', '.docx', 'exe', '.docx', '.rar', ''],
    );
    expect(result.allowedExtensions).toEqual(['.pdf', '.docx']);
  });

  it('rejects updates that resolve to zero valid extensions', async () => {
    await service.ensureDefaultSettings();
    await expect(service.updateSettings(['exe', 'bat', '   '])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('exposes a non-empty mime list only for supported extensions', () => {
    expect(service.getAllowedMimeTypesForExtension('.pdf')).toEqual([
      EXTENSION_MIME_TYPES['.pdf'],
    ]);
    expect(service.getAllowedMimeTypesForExtension('.css')).toEqual(['text/css']);
    expect(service.getAllowedMimeTypesForExtension('.zzz')).toEqual([]);
    expect(service.getAllowedMimeTypesForExtension('not-an-ext')).toEqual([]);
  });

  it('isExtensionAllowed respects the persisted list', async () => {
    store.seed({
      key: WORKSPACE_UPLOAD_SETTINGS_KEY,
      value: { allowedExtensions: ['.txt'] },
      updatedAt: new Date(),
    });
    await service.onApplicationBootstrap();
    expect(await service.isExtensionAllowed('notes.TXT')).toBe(true);
    expect(await service.isExtensionAllowed('image.png')).toBe(false);
    expect(await service.isExtensionAllowed('no-extension')).toBe(false);
  });
});

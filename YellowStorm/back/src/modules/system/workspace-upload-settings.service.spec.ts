import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { SystemSetting } from './schemas/system-setting.schema';
import { WorkspaceUploadSettingsService } from './workspace-upload-settings.service';
import { LoggerService } from '../logger';
import {
  DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS,
  WORKSPACE_UPLOAD_SETTINGS_KEY,
} from './constants/workspace-upload-settings.constants';
import { EXTENSION_MIME_TYPES } from '../document/constants/mime-types.constant';

interface StoredSetting {
  key: string;
  value: { allowedExtensions: string[] };
  updatedAt?: Date;
}

class InMemoryModel {
  private store = new Map<string, StoredSetting>();

  findOne({ key }: { key: string }): {
    lean: () => { exec: () => Promise<StoredSetting | null> };
  } {
    const value = this.store.get(key) ?? null;
    return {
      lean: () => ({
        exec: async () => value,
      }),
    };
  }

  findOneAndUpdate(
    filter: { key: string },
    update: { key: string; value: { allowedExtensions: string[] } },
  ): {
    lean: () => { exec: () => Promise<StoredSetting> };
  } {
    const next: StoredSetting = { key: filter.key, value: update.value, updatedAt: new Date() };
    this.store.set(filter.key, next);
    return {
      lean: () => ({
        exec: async () => next,
      }),
    };
  }

  async create(doc: StoredSetting): Promise<StoredSetting> {
    const stored = { ...doc, updatedAt: new Date() };
    this.store.set(doc.key, stored);
    return stored;
  }

  seed(value: StoredSetting): void {
    this.store.set(value.key, value);
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
  let model: InMemoryModel;

  beforeEach(async () => {
    model = new InMemoryModel();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkspaceUploadSettingsService,
        { provide: getModelToken(SystemSetting.name), useValue: model },
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
    model.seed({
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
      ['PDF', '.pdf', '.docx', 'exe', '.docx', '.zip', ''],
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
    model.seed({
      key: WORKSPACE_UPLOAD_SETTINGS_KEY,
      value: { allowedExtensions: ['.txt'] },
    });
    await service.onApplicationBootstrap();
    expect(await service.isExtensionAllowed('notes.TXT')).toBe(true);
    expect(await service.isExtensionAllowed('image.png')).toBe(false);
    expect(await service.isExtensionAllowed('no-extension')).toBe(false);
  });
});

import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { decodeMultipartFilename } from '@common/utils';
import { isObjectId } from '@common/postgres';
import { withTransaction } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  APPEARANCE_COLOR_THEMES,
  APPEARANCE_LOGO_CONSTRAINTS,
  APPEARANCE_SETTINGS_KEY,
  BUILTIN_APPEARANCE_LOGO_IDS,
  BUILTIN_APPEARANCE_LOGOS,
} from '../constants/appearance-logo.constants';
import type { AppearanceLogo as AppearanceLogoDto } from '../interfaces/appearance.interface';
import { APPEARANCE_LOGO_STORE, type AppearanceLogoRecord, type AppearanceLogoStore } from '../persistence/appearance-logo.store';
import { SYSTEM_SETTING_STORE, type SystemSettingStore } from '../persistence/system-setting.store';
import type { AppearanceValue } from '../schemas/system-setting.schema';
import {
  isAppearanceLogoMime,
  readAppearanceLogoDimensions,
  sniffAppearanceLogoMime,
  validateAppearanceLogoDimensions,
} from '../utils/appearance-image.util';

interface UploadedLogoFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class AppearanceLogoService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(APPEARANCE_LOGO_STORE) private readonly logoStore: AppearanceLogoStore,
    @Inject(SYSTEM_SETTING_STORE) private readonly systemSettings: SystemSettingStore,
  ) {}

  async listPublic(): Promise<AppearanceLogoDto[]> {
    const custom = await this.logoStore.list();
    return [...this.builtinLogos(), ...custom.map((logo) => this.toPublic(logo))];
  }

  async getFile(id: string): Promise<{ contentType: string; data: Buffer; updatedAt: Date }> {
    if (BUILTIN_APPEARANCE_LOGO_IDS.includes(id as (typeof BUILTIN_APPEARANCE_LOGO_IDS)[number])) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
    const logo = await this.logoStore.findWithData(id);
    if (!logo?.data) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
    return { contentType: logo.contentType, data: logo.data, updatedAt: logo.updatedAt };
  }

  async create(file: UploadedLogoFile, name?: string): Promise<AppearanceLogoDto> {
    const parsed = this.parseUpload(file);
    const created = await this.logoStore.createWithinCap(
      {
        name: this.resolveName(name, file.originalname),
        contentType: parsed.mimeType,
        width: parsed.width,
        height: parsed.height,
        data: parsed.buffer,
      },
      APPEARANCE_LOGO_CONSTRAINTS.maxCustomLogos,
    );
    if (!created) {
      throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_LIMIT_REACHED);
    }
    return this.toPublic(created);
  }

  async update(id: string, file: UploadedLogoFile | undefined, name?: string): Promise<AppearanceLogoDto> {
    this.assertCustomId(id);
    const patch: Parameters<AppearanceLogoStore['update']>[1] = {};
    if (name?.trim()) {
      patch.name = name.trim();
    }
    if (file?.buffer?.length) {
      const parsed = this.parseUpload(file);
      patch.contentType = parsed.mimeType;
      patch.width = parsed.width;
      patch.height = parsed.height;
      patch.data = parsed.buffer;
    }
    const updated = await this.logoStore.update(id, patch);
    if (!updated) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
    return this.toPublic(updated);
  }

  async remove(id: string): Promise<void> {
    this.assertCustomId(id);
    // Theme rewrite and delete commit together so a failing unassign cannot
    // leave a logo referenced by the appearance settings.
    await withTransaction(this.db, async () => {
      const deleted = await this.logoStore.delete(id);
      if (!deleted) {
        throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
      }
      await this.unassignLogoFromThemes(id);
    });
  }

  isKnownLogoId(id: string, logos: AppearanceLogoDto[]): boolean {
    return logos.some((logo) => logo.id === id);
  }

  private parseUpload(file: UploadedLogoFile): { mimeType: string; width: number; height: number; buffer: Buffer } {
    if (!file?.buffer?.length) {
      throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_INVALID_TYPE);
    }
    if (file.buffer.length > APPEARANCE_LOGO_CONSTRAINTS.maxBytes) {
      throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_TOO_LARGE);
    }
    const mimeType = sniffAppearanceLogoMime(file.buffer, file.mimetype);
    if (!isAppearanceLogoMime(mimeType)) {
      throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_INVALID_TYPE);
    }
    const dimensions = readAppearanceLogoDimensions(file.buffer, mimeType);
    if (!dimensions) {
      throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_INVALID_TYPE);
    }
    if (!validateAppearanceLogoDimensions(dimensions)) {
      throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_INVALID_DIMENSIONS);
    }
    return {
      mimeType,
      width: dimensions.width,
      height: dimensions.height,
      buffer: file.buffer,
    };
  }

  private resolveName(name: string | undefined, originalname: string): string {
    const decoded = decodeMultipartFilename(originalname);
    const fromFile = decoded.replace(/\.[^.]+$/, '').trim();
    const resolved = (name?.trim() || fromFile || 'Logo').slice(0, 80);
    return resolved.length > 0 ? resolved : 'Logo';
  }

  private assertCustomId(id: string): void {
    if (BUILTIN_APPEARANCE_LOGO_IDS.includes(id as (typeof BUILTIN_APPEARANCE_LOGO_IDS)[number])) {
      throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_BUILTIN_PROTECTED);
    }
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
  }

  private async unassignLogoFromThemes(id: string): Promise<void> {
    const setting = await this.systemSettings.get(APPEARANCE_SETTINGS_KEY);
    if (!setting || typeof setting.value !== 'object' || setting.value === null) {
      return;
    }
    const value = setting.value as AppearanceValue;
    const themes = value.themes;
    if (!themes) {
      return;
    }
    let changed = false;
    for (const theme of APPEARANCE_COLOR_THEMES) {
      if (themes[theme]?.logo === id) {
        themes[theme] = { ...themes[theme], logo: 'yellowmind' };
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    await this.systemSettings.upsert(APPEARANCE_SETTINGS_KEY, value);
  }

  private builtinLogos(): AppearanceLogoDto[] {
    return BUILTIN_APPEARANCE_LOGOS.map((logo) => ({
      id: logo.id,
      name: logo.name,
      kind: 'builtin' as const,
    }));
  }

  private toPublic(logo: AppearanceLogoRecord): AppearanceLogoDto {
    return {
      id: logo.id,
      name: logo.name,
      kind: 'custom',
      contentType: logo.contentType,
      width: logo.width,
      height: logo.height,
      url: `/experimental/system/appearance/logos/${logo.id}/file`,
      updatedAt: logo.updatedAt.toISOString(),
    };
  }
}

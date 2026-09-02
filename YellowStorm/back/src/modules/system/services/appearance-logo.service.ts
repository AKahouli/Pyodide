import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { decodeMultipartFilename } from '@common/utils';
import { BadRequestException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  APPEARANCE_COLOR_THEMES,
  APPEARANCE_LOGO_CONSTRAINTS,
  APPEARANCE_SETTINGS_KEY,
  BUILTIN_APPEARANCE_LOGO_IDS,
  BUILTIN_APPEARANCE_LOGOS,
} from '../constants/appearance-logo.constants';
import type { AppearanceLogo as AppearanceLogoDto } from '../interfaces/appearance.interface';
import { AppearanceLogo, AppearanceLogoDocument } from '../schemas/appearance-logo.schema';
import { AppearanceValue, SystemSetting, SystemSettingDocument } from '../schemas/system-setting.schema';
import {
  isAppearanceLogoMime,
  isUnsafeSvg,
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
    @InjectModel(AppearanceLogo.name)
    private readonly logoModel: Model<AppearanceLogoDocument>,
    @InjectModel(SystemSetting.name)
    private readonly systemSettingModel: Model<SystemSettingDocument>,
  ) {}

  async listPublic(): Promise<AppearanceLogoDto[]> {
    const custom = await this.logoModel.find().select('-data').sort({ createdAt: 1 }).lean().exec();
    return [...this.builtinLogos(), ...custom.map((doc) => this.toPublic(doc))];
  }

  async getFile(id: string): Promise<{ contentType: string; data: Buffer; updatedAt: Date }> {
    if (BUILTIN_APPEARANCE_LOGO_IDS.includes(id as (typeof BUILTIN_APPEARANCE_LOGO_IDS)[number])) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
    const doc = await this.logoModel.findById(id).select('+data').exec();
    if (!doc?.data) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
    return { contentType: doc.contentType, data: doc.data, updatedAt: doc.updatedAt };
  }

  async create(file: UploadedLogoFile, name?: string): Promise<AppearanceLogoDto> {
    const count = await this.logoModel.countDocuments().exec();
    if (count >= APPEARANCE_LOGO_CONSTRAINTS.maxCustomLogos) {
      throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_LIMIT_REACHED);
    }
    const parsed = this.parseUpload(file);
    const doc = await this.logoModel.create({
      name: this.resolveName(name, file.originalname),
      contentType: parsed.mimeType,
      width: parsed.width,
      height: parsed.height,
      data: parsed.buffer,
    });
    return this.toPublic(doc.toObject());
  }

  async update(id: string, file: UploadedLogoFile | undefined, name?: string): Promise<AppearanceLogoDto> {
    this.assertCustomId(id);
    const doc = await this.logoModel.findById(id).select('+data').exec();
    if (!doc) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
    if (name?.trim()) {
      doc.name = name.trim();
    }
    if (file?.buffer?.length) {
      const parsed = this.parseUpload(file);
      doc.contentType = parsed.mimeType;
      doc.width = parsed.width;
      doc.height = parsed.height;
      doc.data = parsed.buffer;
    }
    await doc.save();
    return this.toPublic(doc.toObject());
  }

  async remove(id: string): Promise<void> {
    this.assertCustomId(id);
    await this.unassignLogoFromThemes(id);
    const deleted = await this.logoModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
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
    if (mimeType === 'image/svg+xml' && isUnsafeSvg(file.buffer)) {
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
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
    }
  }

  private async unassignLogoFromThemes(id: string): Promise<void> {
    const setting = await this.systemSettingModel.findOne({ key: APPEARANCE_SETTINGS_KEY }).exec();
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
    setting.markModified('value');
    await setting.save();
  }

  private builtinLogos(): AppearanceLogoDto[] {
    return BUILTIN_APPEARANCE_LOGOS.map((logo) => ({
      id: logo.id,
      name: logo.name,
      kind: 'builtin' as const,
    }));
  }

  private toPublic(doc: { _id: unknown; name: string; contentType: string; width: number; height: number; updatedAt?: Date }): AppearanceLogoDto {
    const id = String(doc._id);
    return {
      id,
      name: doc.name,
      kind: 'custom',
      contentType: doc.contentType,
      width: doc.width,
      height: doc.height,
      url: `/experimental/system/appearance/logos/${id}/file`,
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }
}

import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotFoundException, ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { DEFAULT_APP_BUILDER_AI_OFFERS } from '../constants';
import {
  AppBuilderAiOffer,
  AppBuilderAiOfferDocument,
} from '../schemas/app-builder-ai-offer.schema';

export interface CreateAppBuilderAiOfferInput {
  name: string;
  slug: string;
  description?: string;
  tokenLimit: number;
  windowHours: number;
  requestsPerMinute?: number;
  maxTokensPerRequest?: number;
  priority?: number;
  isActive?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
}

export type UpdateAppBuilderAiOfferInput = Partial<CreateAppBuilderAiOfferInput>;

@Injectable()
export class AppBuilderAiOfferService implements OnModuleInit {
  private readonly logger = new Logger(AppBuilderAiOfferService.name);

  constructor(
    @InjectModel(AppBuilderAiOffer.name)
    private readonly model: Model<AppBuilderAiOfferDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async seedDefaults(): Promise<void> {
    for (const offer of DEFAULT_APP_BUILDER_AI_OFFERS) {
      const existing = await this.model.findOne({ slug: offer.slug }).lean().exec();
      if (existing) continue;
      try {
        await this.model.create({ ...offer });
        this.logger.log(`Seeded App Builder AI offer: ${offer.slug}`);
      } catch (error) {
        if ((error as { code?: number })?.code !== 11000) {
          this.logger.warn(
            `Failed to seed offer ${offer.slug}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  async list(includeInactive = true): Promise<AppBuilderAiOfferDocument[]> {
    const filter = includeInactive ? {} : { isActive: true };
    return this.model.find(filter).sort({ displayOrder: 1, priority: 1 }).exec();
  }

  async findById(id: string): Promise<AppBuilderAiOfferDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model.findById(id).exec();
  }

  async requireById(id: string): Promise<AppBuilderAiOfferDocument> {
    const offer = await this.findById(id);
    if (!offer) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'App Builder AI offer not found');
    }
    return offer;
  }

  async getDefaultOffer(): Promise<AppBuilderAiOfferDocument> {
    const def = await this.model.findOne({ isDefault: true, isActive: true }).exec();
    if (def) return def;
    const any = await this.model.findOne({ isActive: true }).sort({ displayOrder: 1 }).exec();
    if (any) return any;
    await this.seedDefaults();
    const seeded = await this.model.findOne({ isDefault: true }).exec();
    if (!seeded) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'No App Builder AI offer available');
    }
    return seeded;
  }

  async create(input: CreateAppBuilderAiOfferInput): Promise<AppBuilderAiOfferDocument> {
    if (input.isDefault) {
      await this.model.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }
    try {
      return await this.model.create({
        ...input,
        requestsPerMinute: input.requestsPerMinute ?? 60,
        maxTokensPerRequest: input.maxTokensPerRequest ?? -1,
        priority: input.priority ?? 0,
        isActive: input.isActive ?? true,
        isDefault: input.isDefault ?? false,
        displayOrder: input.displayOrder ?? 0,
      });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Offer name or slug already exists');
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateAppBuilderAiOfferInput,
  ): Promise<AppBuilderAiOfferDocument> {
    const offer = await this.requireById(id);
    if (input.isDefault === true) {
      await this.model.updateMany(
        { _id: { $ne: offer._id }, isDefault: true },
        { $set: { isDefault: false } },
      );
    }
    Object.assign(offer, input);
    try {
      await offer.save();
      return offer;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Offer name or slug already exists');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const offer = await this.requireById(id);
    if (offer.isDefault) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Cannot delete the default App Builder AI offer',
      );
    }
    await this.model.deleteOne({ _id: offer._id });
  }
}

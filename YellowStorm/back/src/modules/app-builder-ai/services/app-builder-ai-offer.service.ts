import {
  Injectable, 
  Logger, 
  OnModuleInit, 
} from '@nestjs/common';
import { NotFoundException, ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { DEFAULT_APP_BUILDER_AI_OFFERS } from '../constants';
import {
  type AppBuilderAiOfferRecord,  
  type CreateAppBuilderAiOfferData,  
  type UpdateAppBuilderAiOfferData,  
} from '../persistence/app-builder-ai-offer.store';
import { PgAppBuilderAiOfferStore } from '../persistence/pg-app-builder-ai-offer.store';

export type CreateAppBuilderAiOfferInput = CreateAppBuilderAiOfferData;
export type UpdateAppBuilderAiOfferInput = UpdateAppBuilderAiOfferData;

@Injectable()
export class AppBuilderAiOfferService implements OnModuleInit {
  private readonly logger = new Logger(AppBuilderAiOfferService.name);

  constructor(
    private readonly store: PgAppBuilderAiOfferStore,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async seedDefaults(): Promise<void> {
    const existing = await this.store.list(true);
    if (existing.length > 0) return;
    for (const offer of DEFAULT_APP_BUILDER_AI_OFFERS) {
      try {
        await this.store.seed({ ...offer });
        this.logger.log(`Seeded App Builder AI offer: ${offer.slug}`);
      } catch (error) {
        this.logger.warn(
          `Failed to seed offer ${offer.slug}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async list(includeInactive = true): Promise<AppBuilderAiOfferRecord[]> {
    return this.store.list(includeInactive);
  }

  async findById(id: string): Promise<AppBuilderAiOfferRecord | null> {
    return this.store.findById(id);
  }

  async requireById(id: string): Promise<AppBuilderAiOfferRecord> {
    const offer = await this.findById(id);
    if (!offer) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'App Builder AI offer not found');
    }
    return offer;
  }

  async getDefaultOffer(): Promise<AppBuilderAiOfferRecord> {
    const def = await this.store.findFlaggedDefault();
    if (def) return def;
    const any = await this.store.findFirstActive();
    if (any) return any;
    await this.seedDefaults();
    const seeded = await this.store.findFlaggedDefault();
    if (!seeded) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'No App Builder AI offer available');
    }
    return seeded;
  }

  async create(input: CreateAppBuilderAiOfferInput): Promise<AppBuilderAiOfferRecord> {
    return this.store.insert({
      ...input,
      requestsPerMinute: input.requestsPerMinute ?? 60,
      maxTokensPerRequest: input.maxTokensPerRequest ?? -1,
      priority: input.priority ?? 0,
      isActive: input.isActive ?? true,
      isDefault: input.isDefault ?? false,
      displayOrder: input.displayOrder ?? 0,
    });
  }

  async update(
    id: string,
    input: UpdateAppBuilderAiOfferInput,
  ): Promise<AppBuilderAiOfferRecord> {
    await this.requireById(id);
    const updated = await this.store.update(id, input);
    if (!updated) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'App Builder AI offer not found');
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    const offer = await this.requireById(id);
    if (offer.isDefault) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Cannot delete the default App Builder AI offer',
      );
    }
    await this.store.delete(id);
  }
}

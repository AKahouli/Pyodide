/**
 * Store port for catalog.app_builder_ai_offers (P8 Mongo cutover).
 */

export interface AppBuilderAiOfferRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  tokenLimit: number;
  windowHours: number;
  requestsPerMinute: number;
  maxTokensPerRequest: number;
  priority: number;
  isActive: boolean;
  isDefault: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAppBuilderAiOfferData {
  name: string;
  slug: string;
  description?: string | null;
  tokenLimit: number;
  windowHours: number;
  requestsPerMinute?: number;
  maxTokensPerRequest?: number;
  priority?: number;
  isActive?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  /** Preserve Mongo _id on backfill/seed when provided. */
  id?: string;
}

export type UpdateAppBuilderAiOfferData = Partial<
  Omit<CreateAppBuilderAiOfferData, 'id'>
>;

export interface AppBuilderAiOfferStore {
  list(includeInactive?: boolean): Promise<AppBuilderAiOfferRecord[]>;
  findById(id: string): Promise<AppBuilderAiOfferRecord | null>;
  findBySlug(slug: string): Promise<AppBuilderAiOfferRecord | null>;
  findFlaggedDefault(): Promise<AppBuilderAiOfferRecord | null>;
  findFirstActive(): Promise<AppBuilderAiOfferRecord | null>;
  /** INSERT … ON CONFLICT (slug) DO NOTHING — idempotent seeding. */
  seed(data: CreateAppBuilderAiOfferData): Promise<void>;
  insert(data: CreateAppBuilderAiOfferData): Promise<AppBuilderAiOfferRecord>;
  update(id: string, patch: UpdateAppBuilderAiOfferData): Promise<AppBuilderAiOfferRecord | null>;
  delete(id: string): Promise<boolean>;
}

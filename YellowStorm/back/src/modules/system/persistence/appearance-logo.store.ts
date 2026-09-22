/**
 * Store port for catalog.appearance_logos (plan 1B.2.2).
 * List/find reads exclude the `data` bytes; only findWithData returns them.
 */
export const APPEARANCE_LOGO_STORE = Symbol('APPEARANCE_LOGO_STORE');

export interface AppearanceLogoRecord {
  id: string;
  name: string;
  contentType: string;
  width: number;
  height: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppearanceLogoWithData extends AppearanceLogoRecord {
  data: Buffer;
}

export interface NewAppearanceLogo {
  name: string;
  contentType: string;
  width: number;
  height: number;
  data: Buffer;
}

export type AppearanceLogoPatch = Partial<Omit<NewAppearanceLogo, 'data'>> & { data?: Buffer };

export interface AppearanceLogoStore {
  list(): Promise<AppearanceLogoRecord[]>;
  findWithData(id: string): Promise<AppearanceLogoWithData | null>;
  /**
   * Insert a custom logo while the caller-supplied cap holds. Runs inside a
   * transaction holding pg_advisory_xact_lock so concurrent uploads cannot
   * both pass the count. Returns null when the cap is reached.
   */
  createWithinCap(input: NewAppearanceLogo, maxCustomLogos: number): Promise<AppearanceLogoRecord | null>;
  update(id: string, patch: AppearanceLogoPatch): Promise<AppearanceLogoRecord | null>;
  /** Returns false when the id does not exist. Joins any ambient transaction. */
  delete(id: string): Promise<boolean>;
}

/** Store ports for teams schema (plan 4.3–4.5). */
export const TEAM_STORE = Symbol('TEAM_STORE');
export const TEAM_SHARE_STORE = Symbol('TEAM_SHARE_STORE');
export const TEAM_AUTO_BUILDER_STORE = Symbol('TEAM_AUTO_BUILDER_STORE');

export interface TeamMemberRow {
  agentId: string;
  parentAgentId: string | null;
  order: number;
  positionX: number;
  positionY: number;
}

export interface TeamRow {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  createdBy: string;
  /** In position order (plan 4.3). */
  members: TeamMemberRow[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTeamRow {
  name: string;
  description: string;
  isActive: boolean;
  createdBy: string;
  members: TeamMemberRow[];
}

export interface TeamListQuery {
  createdBy: string;
  search?: string;
  isActive?: boolean;
  page: number;
  limit: number;
}

export interface TeamStore {
  findByOwnerAndName(name: string, createdBy: string): Promise<TeamRow | null>;
  findNameClash(name: string, createdBy: string, excludeId: string): Promise<TeamRow | null>;
  create(row: NewTeamRow): Promise<TeamRow>;
  list(query: TeamListQuery): Promise<{ rows: TeamRow[]; total: number }>;
  findActiveByOwner(userId: string): Promise<TeamRow[]>;
  findById(id: string): Promise<TeamRow | null>;
  /** Update columns; when members is provided the junction is replaced in-tx. */
  update(id: string, patch: Partial<Omit<NewTeamRow, 'createdBy'>>): Promise<TeamRow | null>;
  /** Single DELETE — shares + members cascade (plan 4.3). */
  delete(id: string): Promise<TeamRow | null>;
  findByIdsActiveForOwner(ids: string[], createdBy: string): Promise<TeamRow[]>;
  findByIds(ids: string[]): Promise<TeamRow[]>;
}

export interface TeamShareRow {
  id: string;
  teamId: string;
  sharedBy: string;
  sharedWith: string;
  permission: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamShareStore {
  upsertMany(teamId: string, sharedBy: string, sharedWithIds: string[], permission: string): Promise<TeamShareRow[]>;
  findByTeam(teamId: string): Promise<TeamShareRow[]>;
  find(teamId: string, sharedWith: string): Promise<TeamShareRow | null>;
  findByIdAndTeam(shareId: string, teamId: string): Promise<TeamShareRow | null>;
  updatePermission(shareId: string, teamId: string, permission: string): Promise<TeamShareRow | null>;
  deleteByIdAndTeam(shareId: string, teamId: string): Promise<TeamShareRow | null>;
  deleteForUser(teamId: string, userId: string): Promise<TeamShareRow | null>;
  deleteAllForTeam(teamId: string): Promise<void>;
  listSharedWithUser(userId: string): Promise<TeamShareRow[]>;
}

export interface TeamAutoBuilderConfigRow {
  id: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  isEnabled: boolean;
  updatedAt: Date;
}

export interface TeamAutoBuilderStore {
  /** Singleton read; null when never configured. */
  find(): Promise<TeamAutoBuilderConfigRow | null>;
  /** INSERT … ON CONFLICT (singleton) DO UPDATE (plan 4.5). */
  upsert(config: { modelId: string; systemPrompt: string; temperature: number; isEnabled: boolean }): Promise<TeamAutoBuilderConfigRow>;
}

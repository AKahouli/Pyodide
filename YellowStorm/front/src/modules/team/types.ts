/**
 * Team Module - Types
 *
 * A Team is a user-owned group of agents organised as a hierarchy (org-chart).
 * Mentioning a team in a conversation (`@TeamName`) addresses all of its agents
 * at once; the org-chart lets the user arrange them into a parent/child tree.
 */

export type TeamPermissionLevel = 'read' | 'write';

export interface SharedTeamInfo {
  shareId: string;
  permission: TeamPermissionLevel;
  sharedBy: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

export interface ShareTeamData {
  emails: string[];
  permission: TeamPermissionLevel;
}

export interface TeamShareEntry {
  shareId: string;
  permission: TeamPermissionLevel;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  createdAt: string;
}

/** A user returned by the autocomplete search when sharing a team. */
export interface UserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface TeamMember {
  agentId: string;
  parentAgentId: string | null;
  order: number;
  positionX: number;
  positionY: number;
}

export interface TeamMemberWithAgent extends TeamMember {
  agent?: {
    id: string;
    name: string;
    agentType: { id: string; name: string; slug: string };
    role: string;
    description: string;
  };
}

export interface Team {
  id: string;
  name: string;
  description: string;
  /** Team members with their hierarchy/position metadata. */
  members: TeamMember[];
  agentCount: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Present when the team was shared with the current user (non-owner). */
  shareInfo?: SharedTeamInfo;
}

/** A team whose members are enriched with their agent details (org-chart). */
export interface TeamWithAgents extends Omit<Team, 'members'> {
  members: TeamMemberWithAgent[];
}

export interface CreateTeamData {
  name: string;
  description?: string;
  agentIds?: string[];
}

export interface UpdateTeamData {
  name?: string;
  description?: string;
  agentIds?: string[];
  isActive?: boolean;
}

export interface UpdateHierarchyData {
  members: TeamMember[];
}

export interface GenerateTeamData {
  name: string;
  prompt: string;
}

export interface TeamState {
  teams: Team[];
  currentTeam: TeamWithAgents | null;
  currentTeamLoading: boolean;
  isGenerating: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  lastFetchedAt: Date | null;
}

export interface TeamActions {
  fetchTeams: () => Promise<void>;
  fetchTeamById: (id: string) => Promise<TeamWithAgents>;
  refreshTeams: () => Promise<void>;
  createTeam: (data: CreateTeamData) => Promise<Team>;
  updateTeam: (id: string, data: UpdateTeamData) => Promise<Team>;
  updateHierarchy: (id: string, data: UpdateHierarchyData) => Promise<TeamWithAgents>;
  generateTeam: (data: GenerateTeamData) => Promise<TeamWithAgents>;
  deleteTeam: (id: string) => Promise<void>;
  unshareTeam: (id: string) => Promise<void>;
  getTeamById: (id: string) => Team | undefined;
  setCurrentTeam: (team: TeamWithAgents | null) => void;
  reset: () => void;
}

export type TeamStore = TeamState & TeamActions;

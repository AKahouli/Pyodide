/** A single member of a team with its hierarchy/position metadata. */
export interface ITeamMemberResponse {
  agentId: string;
  parentAgentId: string | null;
  order: number;
  positionX: number;
  positionY: number;
}

/** A team member enriched with (a subset of) its agent's details. */
export interface ITeamMemberWithAgentResponse extends ITeamMemberResponse {
  agent?: {
    id: string;
    name: string;
    agentType: { id: string; name: string };
    role: string;
    description: string;
  };
}

export type TeamPermissionLevel = 'read' | 'write';

/** A single share entry on a team (owner's view of who it's shared with). */
export interface ITeamShareEntry {
  shareId: string;
  permission: TeamPermissionLevel;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  createdAt: Date;
}

/** Info about a team shared with the current user (populated for non-owners). */
export interface ISharedTeamInfo {
  shareId: string;
  permission: 'read' | 'write';
  sharedBy: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

/** A team as returned by the API: a hierarchy of agent members owned by a user. */
export interface ITeamResponse {
  id: string;
  name: string;
  description: string;
  members: ITeamMemberResponse[];
  agentCount: number;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  shareInfo?: ISharedTeamInfo;
}

/** A team with each member enriched with its agent details (for the org-chart). */
export interface ITeamWithAgentsResponse extends Omit<ITeamResponse, 'members'> {
  members: ITeamMemberWithAgentResponse[];
}

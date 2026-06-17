// Team Module - Public API
export {
  useTeamStore,
  useTeams,
  usePersonalTeams,
  useSharedTeams,
  useCurrentTeam,
  useCurrentTeamLoading,
  useIsGenerating,
  useTeamsLoading,
  useTeamsInitialized,
  useTeamsError,
  useTeamById,
} from './store';
export { TeamButton, TeamsPage, CreateEditTeamDialog, ShareTeamDialog, TeamOrgChartPage } from './components';
export * as teamApi from './api';
export type {
  Team,
  TeamWithAgents,
  TeamMember,
  TeamMemberWithAgent,
  UpdateHierarchyData,
  TeamState,
  TeamActions,
  TeamStore,
  CreateTeamData,
  UpdateTeamData,
  ShareTeamData,
  TeamShareEntry,
  SharedTeamInfo,
  TeamPermissionLevel,
} from './types';

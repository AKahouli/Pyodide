import type { CreateGovernanceProgramPayload, CreateGovernanceScopePayload, GovernanceProgram, GovernanceScope } from './types';

const MAX_NAME_LENGTH = 160;

function copyName(name: string, suffix: string): string {
  return `${name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
}

export function createGovernanceProgramClonePayload(program: GovernanceProgram, suffix: string): CreateGovernanceProgramPayload {
  return {
    name: copyName(program.name, suffix),
    description: program.description,
    domain: program.domain,
    defaultLanguage: program.defaultLanguage,
  };
}

export function createGovernanceScopeClonePayload(scope: GovernanceScope, suffix: string): CreateGovernanceScopePayload {
  return {
    name: copyName(scope.name, suffix),
    type: scope.type,
    parentScopeId: scope.parentScopeId,
    agentIds: [...scope.agentIds],
  };
}

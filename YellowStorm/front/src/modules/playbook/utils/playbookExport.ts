import type {
  Playbook,
  PlaybookDefinitionExport,
} from '../types';
import { PLAYBOOK_DEFINITION_VERSION } from '../types';

export const RUNTIME_TASK_FIELDS = new Set([
  'hasValidatedReplay',
  'activeReplayId',
  'activeReplayVersion',
  'activeReplayIsStale',
  'activeReplayStaleReasons',
  'activeReplayPreserveOutputFormat',
  'activeReplayFormatGuideStatus',
  'activeReplayFormatGuideError',
  'activeReplayLabel',
  'hasOutputFormatTemplate',
  'activeOutputFormatTemplateId',
  'activeOutputFormatTemplateVersion',
  'activeOutputFormatStatus',
  'activeOutputFormatError',
  'isSavingReplayBaseline',
  'isCapturingOutputFormat',
  'stepReplayMode',
]);

function stripRuntimeFields<T extends Record<string, unknown>>(obj: T, fieldsToRemove: Set<string>): T {
  const result = { ...obj };
  for (const field of fieldsToRemove) {
    delete (result as Record<string, unknown>)[field];
  }
  return result;
}

export function buildPlaybookExport(playbook: Playbook): PlaybookDefinitionExport {
  const portableTasks = playbook.tasks.map((task) =>
    stripRuntimeFields(task as unknown as Record<string, unknown>, RUNTIME_TASK_FIELDS),
  );

  return {
    version: PLAYBOOK_DEFINITION_VERSION,
    exportedAt: new Date().toISOString(),
    name: playbook.name,
    description: playbook.description,
    tasks: portableTasks as unknown as PlaybookDefinitionExport['tasks'],
    edges: playbook.edges,
    nodes: playbook.nodes,
    controlEdges: playbook.controlEdges,
    dataBindings: playbook.dataBindings,
    settings: playbook.settings,
    designSettings: playbook.designSettings,
    reflectionEnabled: playbook.reflectionEnabled,
    advisorScoringMode: playbook.advisorScoringMode,
    advisorAutopilotEnabled: playbook.advisorAutopilotEnabled,
    advisorAutopilotTargetScore: playbook.advisorAutopilotTargetScore,
    advisorAutopilotMaxTurns: playbook.advisorAutopilotMaxTurns,
  };
}

export function exportPlaybookDefinition(playbook: Playbook): void {
  const definition = buildPlaybookExport(playbook);
  const json = JSON.stringify(definition, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const sanitized = playbook.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  link.href = url;
  link.download = `playbook-${sanitized}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

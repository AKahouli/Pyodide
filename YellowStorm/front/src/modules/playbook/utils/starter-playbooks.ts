import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';
import type { PlaybookDefinitionExport } from '../types';
import { buildTaskFromBlueprint, createControlEdge, createNodeOutputBinding } from './step-creation';

export const STARTER_KEYS = ['meeting', 'support', 'brief'] as const;
export type StarterKey = typeof STARTER_KEYS[number];
type Translate = (key: ModuleTranslationKey<'playbook'>, params?: TranslationParams) => string;

export function buildStarterPlaybook(key: StarterKey, sample: string, agentId: string, t: Translate): PlaybookDefinitionExport {
  if (!sample.trim() || !agentId) throw new Error('A sample and an agent are required');
  const tasks = [0, 1].map((index) => ({
    ...buildTaskFromBlueprint({ kind: 'blank' }, {
      position: { x: 100 + index * 360, y: 180 }, executionOrder: index,
      titles: { blankStep: '', router: '', humanApproval: '' },
    }),
    title: t(`starter.${key}.step${index + 1}` as ModuleTranslationKey<'playbook'>),
    description: t(`starter.${key}.prompt${index + 1}` as ModuleTranslationKey<'playbook'>),
    assignedAgentId: agentId,
    inputPorts: [{ id: 'default', name: t(index === 0 ? 'starter.sampleInput' : 'starter.previousOutput'), artifactKind: 'text' as const, required: true }],
    outputPorts: [{ id: 'default', name: t('starter.result'), artifactKind: 'text' as const }],
  }));
  return {
    version: 1, exportedAt: new Date().toISOString(),
    name: t(`starter.${key}.title`), description: t(`starter.${key}.description`), tasks,
    edges: [createControlEdge(tasks[0].id, 'default', tasks[1].id, 'default')],
    dataBindings: [
      { id: crypto.randomUUID(), targetNode: tasks[0].id, targetPort: 'default', sourceKind: 'constant', constantValue: { text: sample } },
      createNodeOutputBinding(tasks[0].id, 'default', tasks[1].id, 'default'),
    ],
  };
}

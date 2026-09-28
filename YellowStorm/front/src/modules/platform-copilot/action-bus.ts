import { z } from 'zod';
import type { NavigateFunction } from 'react-router-dom';
import type { PlatformCopilotPageContext, PlatformCopilotUiTarget } from './types';

const paramsSchema = z.object({
  playbookId: z.string().min(1).max(200).optional(),
  executionId: z.string().min(1).max(200).optional(),
  taskId: z.string().min(1).max(200).optional(),
  operationId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(200).optional(),
  modelName: z.string().min(1).max(300).optional(),
  continuationId: z.string().min(1).max(200).optional(),
  playbookName: z.string().min(1).max(300).optional(),
}).strict();

const targetSchema = z.object({
  surface: z.enum([
    'playbook.list',
    'playbook.editor',
    'playbook.editor.assistant',
    'playbook.validation',
    'playbook.execution.details',
    'playbook.execution.task',
    'semanticModel.editor',
    'semanticModel.sources',
    'playbook.sources',
  ]),
  params: paramsSchema,
  effects: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('highlightTask'), taskId: z.string().min(1).max(200) }).strict(),
    z.object({ type: z.literal('focusExecutionStatus') }).strict(),
  ])).max(5).optional(),
}).strict();

export type UiActionResult = { ok: true } | { ok: false; reason: 'invalid_target' | 'missing_parameter' | 'navigation_cancelled' };

export function executePlatformCopilotUiTarget(input: {
  target: PlatformCopilotUiTarget;
  pageContext: PlatformCopilotPageContext;
  navigate: NavigateFunction;
  confirmNavigation: () => boolean;
}): UiActionResult {
  const parsed = targetSchema.safeParse(input.target);
  if (!parsed.success) return { ok: false, reason: 'invalid_target' };
  const target = parsed.data;
  const playbookId = target.params.playbookId;
  const executionId = target.params.executionId;
  let route: string;
  switch (target.surface) {
    case 'playbook.list':
      route = '/playbooks';
      break;
    case 'playbook.editor':
      if (!playbookId) return { ok: false, reason: 'missing_parameter' };
      route = `/playbooks/${encodeURIComponent(playbookId)}`;
      break;
    case 'playbook.editor.assistant': {
      if (!playbookId) return { ok: false, reason: 'missing_parameter' };
      const operationId = target.params.operationId;
      const query = operationId ? `?assistantOperation=${encodeURIComponent(operationId)}` : '';
      route = `/playbooks/${encodeURIComponent(playbookId)}${query}`;
      break;
    }
    case 'playbook.validation':
      if (!playbookId) return { ok: false, reason: 'missing_parameter' };
      route = `/playbooks/${encodeURIComponent(playbookId)}?tab=validation`;
      break;
    case 'playbook.execution.details':
    case 'playbook.execution.task': {
      if (!playbookId || !executionId) return { ok: false, reason: 'missing_parameter' };
      const taskId = target.params.taskId;
      const suffix = target.surface === 'playbook.execution.task' && taskId
        ? `?taskId=${encodeURIComponent(taskId)}`
        : '';
      route = `/playbooks/${encodeURIComponent(playbookId)}/executions/${encodeURIComponent(executionId)}${suffix}`;
      break;
    }
    case 'playbook.sources':
      // Shown as a card in the conversation; as a link it only leads to the library.
      route = playbookId ? `/playbooks/${encodeURIComponent(playbookId)}` : '/playbooks';
      break;
    case 'semanticModel.editor':
    case 'semanticModel.sources': {
      const modelId = target.params.modelId;
      if (!modelId) return { ok: false, reason: 'missing_parameter' };
      route = `/semantic-models/${encodeURIComponent(modelId)}${target.surface === 'semanticModel.sources' ? '?sources=1' : ''}`;
      break;
    }
  }
  if (target.effects?.length) {
    const [path, rawQuery = ''] = route.split('?');
    const query = new URLSearchParams(rawQuery);
    for (const effect of target.effects) {
      if (effect.type === 'highlightTask') query.set('mascotTask', effect.taskId);
      if (effect.type === 'focusExecutionStatus') query.set('mascotFocusStatus', '1');
    }
    const serialized = query.toString();
    route = serialized ? `${path}?${serialized}` : path;
  }
  if (input.pageContext.hasUnsavedChanges && route !== input.pageContext.route && !input.confirmNavigation()) {
    return { ok: false, reason: 'navigation_cancelled' };
  }
  input.navigate(route);
  return { ok: true };
}

export function findUiTargets(value: unknown, depth = 0): PlatformCopilotUiTarget[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === 'string') {
    try {
      return findUiTargets(JSON.parse(value), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((item) => findUiTargets(item, depth + 1));
  if (typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const direct = targetSchema.safeParse(record.uiTarget);
  return [
    ...(direct.success ? [direct.data as PlatformCopilotUiTarget] : []),
    ...Object.values(record).flatMap((item) => findUiTargets(item, depth + 1)),
  ];
}

export function dedupePlatformCopilotUiTargets(targets: PlatformCopilotUiTarget[]): PlatformCopilotUiTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const identity = getPlatformCopilotUiTargetIdentity(target);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function getPlatformCopilotUiTargetIdentity(target: PlatformCopilotUiTarget): string {
  const { playbookId = '', executionId = '', taskId = '', operationId = '', modelId = '' } = target.params;
  switch (target.surface) {
    case 'playbook.list':
      return JSON.stringify([target.surface, target.effects ?? []]);
    case 'playbook.editor':
    case 'playbook.validation':
      return JSON.stringify([target.surface, playbookId, target.effects ?? []]);
    case 'playbook.editor.assistant':
      return JSON.stringify([target.surface, playbookId, operationId, target.effects ?? []]);
    case 'playbook.execution.details':
      return JSON.stringify([target.surface, playbookId, executionId, target.effects ?? []]);
    case 'playbook.execution.task':
      return JSON.stringify([target.surface, playbookId, executionId, taskId, target.effects ?? []]);
    case 'semanticModel.editor':
    case 'semanticModel.sources':
      return JSON.stringify([target.surface, modelId]);
    case 'playbook.sources':
      return JSON.stringify([target.surface, target.params.continuationId ?? '']);
  }
}

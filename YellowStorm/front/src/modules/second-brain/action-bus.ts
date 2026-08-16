import { z } from 'zod';
import type { NavigateFunction } from 'react-router-dom';
import type { SecondBrainPageContext, SecondBrainUiTarget } from './types';

const paramsSchema = z.object({
  playbookId: z.string().min(1).max(200).optional(),
  executionId: z.string().min(1).max(200).optional(),
  taskId: z.string().min(1).max(200).optional(),
  operationId: z.string().min(1).max(200).optional(),
}).strict();

const targetSchema = z.object({
  surface: z.enum([
    'playbook.list',
    'playbook.editor',
    'playbook.editor.assistant',
    'playbook.validation',
    'playbook.execution.details',
    'playbook.execution.task',
  ]),
  params: paramsSchema,
  effects: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('selectTab'), tab: z.string().min(1).max(100) }).strict(),
    z.object({ type: z.literal('highlightTask'), taskId: z.string().min(1).max(200) }).strict(),
    z.object({ type: z.literal('focusExecutionStatus') }).strict(),
  ])).max(5).optional(),
}).strict();

export type UiActionResult = { ok: true } | { ok: false; reason: 'invalid_target' | 'missing_parameter' | 'navigation_cancelled' };

export function executeSecondBrainUiTarget(input: {
  target: SecondBrainUiTarget;
  pageContext: SecondBrainPageContext;
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
        ? `?taskId=${encodeURIComponent(taskId)}&mascotHighlight=1`
        : '';
      route = `/playbooks/${encodeURIComponent(playbookId)}/executions/${encodeURIComponent(executionId)}${suffix}`;
      break;
    }
  }
  if (input.pageContext.hasUnsavedChanges && route !== input.pageContext.route && !input.confirmNavigation()) {
    return { ok: false, reason: 'navigation_cancelled' };
  }
  input.navigate(route);
  return { ok: true };
}

export function findUiTargets(value: unknown, depth = 0): SecondBrainUiTarget[] {
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
    ...(direct.success ? [direct.data as SecondBrainUiTarget] : []),
    ...Object.values(record).flatMap((item) => findUiTargets(item, depth + 1)),
  ];
}

export function dedupeSecondBrainUiTargets(targets: SecondBrainUiTarget[]): SecondBrainUiTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const identity = getSecondBrainUiTargetIdentity(target);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function getSecondBrainUiTargetIdentity(target: SecondBrainUiTarget): string {
  const { playbookId = '', executionId = '', taskId = '', operationId = '' } = target.params;
  switch (target.surface) {
    case 'playbook.list':
      return target.surface;
    case 'playbook.editor':
    case 'playbook.validation':
      return JSON.stringify([target.surface, playbookId]);
    case 'playbook.editor.assistant':
      return JSON.stringify([target.surface, playbookId, operationId]);
    case 'playbook.execution.details':
      return JSON.stringify([target.surface, playbookId, executionId]);
    case 'playbook.execution.task':
      return JSON.stringify([target.surface, playbookId, executionId, taskId]);
  }
}

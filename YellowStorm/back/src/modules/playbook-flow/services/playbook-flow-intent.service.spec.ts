import { PlaybookFlowIntentService } from './playbook-flow-intent.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';
import { PlaybookFlowPromptTemplateService } from './playbook-flow-prompt-template.service';
import { PlaybookFlowPromptRendererService } from './playbook-flow-prompt-renderer.service';
import { PlaybookFlowNodeTemplateService } from './playbook-flow-node-template.service';
import { AgentService } from '@modules/agent/agent.service';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';

import type { EffectiveFlowDesignSettings } from '../interfaces/playbook-flow-settings.interface';

const DEFAULT_LIMITS: EffectiveFlowDesignSettings['intentNormalizationLimits'] = {
  maxWorkflowPlanChanges: 8,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 24,
};

function createService(): PlaybookFlowIntentService {
  return new PlaybookFlowIntentService(
    {} as PlaybookFlowService,
    {} as PlaybookFlowSettingsService,
    {} as PlaybookFlowPromptTemplateService,
    {} as PlaybookFlowPromptRendererService,
    {} as AgentService,
    {} as PlaybookFlowNodeTemplateService,
    {} as LiteLLMConnectionService,
  );
}

function makeContext(overrides: Partial<{
  existingTaskIds: string[];
  existingTaskTitles: Array<[string, string]>;
  existingTaskAgents: Array<[string, string | null]>;
  inputPortsByTaskId: Array<[string, Array<[string, string]>]>;
  outputPortsByTaskId: Array<[string, Array<[string, string]>]>;
}> = {}) {
  const existingTaskIds = new Set(overrides.existingTaskIds || []);
  const existingTaskTitles = new Map(overrides.existingTaskTitles || []);
  const existingTaskAgents = new Map(overrides.existingTaskAgents || []);
  const inputPortsByTaskId = new Map(
    (overrides.inputPortsByTaskId || []).map(([k, v]) => [k, new Map(v)]),
  );
  const outputPortsByTaskId = new Map(
    (overrides.outputPortsByTaskId || []).map(([k, v]) => [k, new Map(v)]),
  );
  return {
    existingTaskIds,
    existingTaskTitles,
    existingTaskAgents,
    inputPortsByTaskId,
    outputPortsByTaskId,
    existingBindingTargets: new Set<string>(),
  };
}

describe('PlaybookFlowIntentService normalization', () => {
  let service: PlaybookFlowIntentService;

  beforeEach(() => {
    service = createService();
  });

  const callNormalize = (raw: string, ctx: ReturnType<typeof makeContext>) => {
    return (service as any).normalizeSuggestions(
      raw,
      { intent: 'test' },
      null,
      DEFAULT_LIMITS,
      ctx,
    );
  };

  it('drops duplicate create_node.nodeRef in one plan', () => {
    const ctx = makeContext();
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        summary: 'Test',
        reason: 'Test',
        confidence: 0.9,
        changes: [
          { type: 'create_node', nodeRef: 'node-a', task: { title: 'Task A', description: 'Desc' } },
          { type: 'create_node', nodeRef: 'node-a', task: { title: 'Task A Dup', description: 'Desc' } },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeDefined();
    expect(plan.changes.length).toBe(1);
    expect(plan.changes[0].nodeRef).toBe('node-a');
  });

  it('drops update_node with unknown targetTaskId', () => {
    const ctx = makeContext({ existingTaskIds: ['task-1'] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [
          { type: 'update_node', targetTaskId: 'task-unknown', task: { title: 'Updated' } },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });

  it('drops delete_node with unknown targetTaskId', () => {
    const ctx = makeContext({ existingTaskIds: ['task-1'] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [
          { type: 'delete_node', targetTaskId: 'task-unknown' },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });

  it('drops create_edge referencing unknown existing task', () => {
    const ctx = makeContext({ existingTaskIds: ['task-1'] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [
          { type: 'create_edge', sourceTaskId: 'task-1', targetTaskId: 'task-unknown' },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });

  it('drops create_edge referencing a task scheduled for deletion', () => {
    const ctx = makeContext({ existingTaskIds: ['task-1', 'task-2'] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [
          { type: 'delete_node', targetTaskId: 'task-2' },
          { type: 'create_edge', sourceTaskId: 'task-1', targetTaskId: 'task-2' },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeDefined();
    expect(plan.changes.length).toBe(1);
    expect(plan.changes[0].type).toBe('delete_node');
  });

  it('drops create_data_binding when source port does not exist', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1', 'task-2'],
      outputPortsByTaskId: [['task-1', [['out-1', 'text']]]],
      inputPortsByTaskId: [['task-2', [['in-1', 'text']]]],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [{
          type: 'create_data_binding',
          sourceKind: 'node-output',
          sourceTaskId: 'task-1',
          sourcePort: 'out-nonexistent',
          targetTaskId: 'task-2',
          targetPort: 'in-1',
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });

  it('drops create_data_binding when target port does not exist', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1', 'task-2'],
      outputPortsByTaskId: [['task-1', [['out-1', 'text']]]],
      inputPortsByTaskId: [['task-2', [['in-1', 'text']]]],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [{
          type: 'create_data_binding',
          sourceKind: 'node-output',
          sourceTaskId: 'task-1',
          sourcePort: 'out-1',
          targetTaskId: 'task-2',
          targetPort: 'in-nonexistent',
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });

  it('drops create_data_binding when artifact kinds mismatch', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1', 'task-2'],
      outputPortsByTaskId: [['task-1', [['out-1', 'text']]]],
      inputPortsByTaskId: [['task-2', [['in-1', 'document']]]],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [{
          type: 'create_data_binding',
          sourceKind: 'node-output',
          sourceTaskId: 'task-1',
          sourcePort: 'out-1',
          targetTaskId: 'task-2',
          targetPort: 'in-1',
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });

  it('drops exact duplicate title + agent create_node against existing workflow', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1'],
      existingTaskTitles: [['task-1', 'research competitors']],
      existingTaskAgents: [['task-1', 'analyst']],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [{
          type: 'create_node',
          nodeRef: 'node-new',
          task: { title: 'Research Competitors', description: 'Do it', agentSlug: 'analyst' },
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });

  it('recalculates impact from accepted changes when no LLM impact provided', () => {
    const ctx = makeContext({ existingTaskIds: ['task-1'] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [
          { type: 'create_node', nodeRef: 'node-a', task: { title: 'A', description: 'A' } },
          { type: 'update_node', targetTaskId: 'task-unknown', task: { title: 'X' } },
          { type: 'update_node', targetTaskId: 'task-1', task: { title: 'Updated' } },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeDefined();
    expect(plan.changes.length).toBe(2);
    expect(plan.impact.nodesToCreate).toBe(1);
    expect(plan.impact.nodesToUpdate).toBe(1);
  });

  it('allows create_node with same title but different agent', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1'],
      existingTaskTitles: [['task-1', 'research competitors']],
      existingTaskAgents: [['task-1', 'analyst']],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [{
          type: 'create_node',
          nodeRef: 'node-new',
          task: { title: 'Research Competitors', description: 'Do it', agentSlug: 'writer' },
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeDefined();
    expect(plan.changes.length).toBe(1);
  });

  it('allows valid create_edge referencing previously created nodeRef', () => {
    const ctx = makeContext({ existingTaskIds: ['task-1'] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [
          { type: 'create_node', nodeRef: 'node-a', task: { title: 'A', description: 'A' } },
          { type: 'create_edge', sourceTaskId: 'task-1', targetNodeRef: 'node-a' },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeDefined();
    expect(plan.changes.length).toBe(2);
    expect(plan.changes[1].type).toBe('create_edge');
  });

  it('rejects update_node that falls back to nodeRef', () => {
    const ctx = makeContext({ existingTaskIds: [] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [
          { type: 'update_node', nodeRef: 'some-ref', task: { title: 'Updated' } },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });

  it('rejects delete_node that falls back to nodeRef', () => {
    const ctx = makeContext({ existingTaskIds: [] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [
          { type: 'delete_node', nodeRef: 'some-ref' },
        ],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeUndefined();
  });
});

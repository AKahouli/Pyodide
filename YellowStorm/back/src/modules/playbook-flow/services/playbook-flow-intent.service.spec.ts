import { PlaybookFlowIntentService } from './playbook-flow-intent.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';
import { PlaybookFlowPromptTemplateService } from './playbook-flow-prompt-template.service';
import { PlaybookFlowPromptRendererService } from './playbook-flow-prompt-renderer.service';
import { PlaybookFlowNodeTemplateService } from './playbook-flow-node-template.service';
import { AgentService } from '@modules/agent/agent.service';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { DEFAULT_FLOW_PROMPTS } from './playbook-flow-prompt-seed';

import type { EffectiveFlowDesignSettings } from '../interfaces/playbook-flow-settings.interface';

const DEFAULT_LIMITS: EffectiveFlowDesignSettings['intentNormalizationLimits'] = {
  maxWorkflowPlanChanges: 8,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 24,
};

function createService(overrides: Partial<{
  promptService: PlaybookFlowPromptTemplateService;
  promptRenderer: PlaybookFlowPromptRendererService;
}> = {}): PlaybookFlowIntentService {
  return new PlaybookFlowIntentService(
    {} as PlaybookFlowService,
    {} as PlaybookFlowSettingsService,
    overrides.promptService || {} as PlaybookFlowPromptTemplateService,
    overrides.promptRenderer || {} as PlaybookFlowPromptRendererService,
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

  const callNormalizeDesign = (raw: string) => {
    return (service as any).normalizeDesignAssessment(raw, 'Build invoice workflow');
  };

  it('normalizes design clarification choices and caps questions', () => {
    const result = callNormalizeDesign(JSON.stringify({
      status: 'needs_clarification',
      detectedIntent: 'Build invoice workflow',
      questions: [
        { id: 'q1', question: 'Which datasource?', category: 'datasource', choices: ['SAP', 'SAP', 'SharePoint', 'Email', 'Upload'], resourceSelector: 'workspace_or_document' },
        { id: 'q2', question: 'What trigger?', category: 'trigger', resourceSelector: 'connector' },
        { id: 'q3', question: 'What output?', category: 'output', choices: ['Report'] },
        { id: 'q4', question: 'Which approval?', category: 'approval', choices: ['Manager'] },
        { id: 'q5', question: 'Which rule?', category: 'business_rule', choices: ['Overdue only'] },
        { id: 'q6', question: 'Extra question?', category: 'scope', choices: ['Extra'] },
      ],
    }));

    expect(result.status).toBe('needs_clarification');
    if (result.status !== 'needs_clarification') return;
    expect(result.questions).toHaveLength(4);
    expect(result.questions[0].choices).toEqual(['SAP', 'SharePoint', 'Email', 'Upload']);
    expect(result.questions[0].resourceSelector).toBe('workspace_or_document');
    expect(result.questions[1].choices).toEqual([]);
    expect(result.questions[1].resourceSelector).toBeUndefined();
  });

  it('uses the customizable design assessment prompt when available', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Ready"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({ systemTemplate: 'Custom design assessment prompt' }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({ promptService });
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'test-model',
      systemPrompt: '',
      userPrompt: 'User intent context',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
    });

    await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });

    expect(promptService.findByKey).toHaveBeenCalledWith('intent.design_assessment');
    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'Custom design assessment prompt' },
        { role: 'user', content: 'User intent context' },
      ],
    }), { timeout: 180000 });
  });

  it('renders the customizable design assessment user prompt when configured', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Ready"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Custom design assessment prompt',
        userTemplate: 'Intent={intent_text}\nClarifications={captured_clarifications}',
      }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({ promptService, promptRenderer: new PlaybookFlowPromptRendererService() });
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'test-model',
      systemPrompt: '',
      userPrompt: 'Fallback user context',
      promptVariables: {
        intent_text: 'Build workflow',
        captured_clarifications: 'Which datasource?: SAP',
      },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
    });

    await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });

    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'Custom design assessment prompt' },
        { role: 'user', content: 'Intent=Build workflow\nClarifications=Which datasource?: SAP' },
      ],
    }), { timeout: 180000 });
  });

  it('keeps captured clarifications in intent text for customized prompts without the new placeholder', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Ready"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Custom design assessment prompt',
        userTemplate: 'Intent={intent_text}',
      }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({ promptService, promptRenderer: new PlaybookFlowPromptRendererService() });
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'test-model',
      systemPrompt: '',
      userPrompt: 'Fallback user context',
      promptVariables: {
        intent_text: 'Build workflow',
        captured_clarifications: 'Which datasource?: SAP',
      },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
    });

    await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });

    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'Custom design assessment prompt' },
        { role: 'user', content: 'Intent=Build workflow\n\nClarifications:\nWhich datasource?: SAP' },
      ],
    }), { timeout: 180000 });
  });

  it('does not treat unsupported spaced single-brace placeholders as clarification placeholders', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Ready"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Custom design assessment prompt',
        userTemplate: 'Intent={intent_text}\nClarifications={ captured_clarifications }',
      }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({ promptService, promptRenderer: new PlaybookFlowPromptRendererService() });
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'test-model',
      systemPrompt: '',
      userPrompt: 'Fallback user context',
      promptVariables: {
        intent_text: 'Build workflow',
        captured_clarifications: 'Which datasource?: SAP',
      },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
    });

    await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });

    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'Custom design assessment prompt' },
        { role: 'user', content: 'Intent=Build workflow\n\nClarifications:\nWhich datasource?: SAP\nClarifications={ captured_clarifications }' },
      ],
    }), { timeout: 180000 });
  });

  it('falls back to the built-in design assessment prompt when no template is configured', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Ready"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue(null),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({ promptService });
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'test-model',
      systemPrompt: '',
      userPrompt: 'User intent context',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
    });

    await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });

    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: expect.stringContaining('strict workflow design reviewer') },
        { role: 'user', content: 'User intent context' },
      ],
    }), { timeout: 180000 });
  });

  it('falls back to clarification questions when design JSON is malformed', () => {
    const result = callNormalizeDesign('not-json');

    expect(result.status).toBe('needs_clarification');
    if (result.status !== 'needs_clarification') return;
    expect(result.questions[0].choices.length).toBeGreaterThan(0);
  });

  it('splits captured clarification answers from the base intent', () => {
    const result = (service as any).splitIntentClarifications(
      'Build invoice workflow\n\nClarifications:\nWhich datasource?: SAP\nWhat output?: CSV',
    );

    expect(result).toEqual({
      intentText: 'Build invoice workflow',
      capturedClarifications: 'Which datasource?: SAP\nWhat output?: CSV',
    });
  });

  it('returns no captured clarifications when the marker is absent', () => {
    const result = (service as any).splitIntentClarifications('Build invoice workflow');

    expect(result).toEqual({
      intentText: 'Build invoice workflow',
      capturedClarifications: '',
    });
  });

  it('extracts resolved design resources from captured clarification metadata', () => {
    const result = (service as any).extractResolvedDesignResources([
      'What is the source?: invoice.xlsx [kind=document, id=doc-1, workspaceId=workspace-1, workspaceName=Finance, path=/Finance/invoice.xlsx, mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet]',
      'Where should it be saved?: Finance [kind=workspace, id=workspace-1, workspaceName=Finance]',
      'What if file exists?: Overwrite the existing file',
    ].join('\n'));

    expect(result).toEqual([
      {
        question: 'What is the source?',
        label: 'invoice.xlsx',
        kind: 'document',
        id: 'doc-1',
        workspaceId: 'workspace-1',
        workspaceName: 'Finance',
        path: '/Finance/invoice.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      {
        question: 'Where should it be saved?',
        label: 'Finance',
        kind: 'workspace',
        id: 'workspace-1',
        workspaceName: 'Finance',
      },
    ]);
  });

  it('keeps commas inside resolved resource metadata values', () => {
    const result = (service as any).extractResolvedDesignResources(
      'What is the source?: invoice.xlsx [kind=document, id=doc-1, workspaceId=workspace-1, workspaceName=Finance, EMEA, path=/Finance, EMEA/invoice.xlsx, mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet]',
    );

    expect(result[0]).toEqual(expect.objectContaining({
      workspaceName: 'Finance, EMEA',
      path: '/Finance, EMEA/invoice.xlsx',
    }));
  });

  it('adds resolved resources to captured clarification fallback for old custom prompts', () => {
    const result = (service as any).withClarificationTemplateFallback({
      intent_text: 'Build workflow',
      captured_clarifications: 'What is the source?: invoice.xlsx [kind=document, id=doc-1, workspaceId=workspace-1]',
      resolved_design_resources: JSON.stringify([{ question: 'What is the source?', kind: 'document', id: 'doc-1', workspaceId: 'workspace-1' }], null, 2),
    }, 'Intent={intent_text}\nClarifications={captured_clarifications}');

    expect(result.captured_clarifications).toContain('<Resolved_Design_Resources>');
    expect(result.captured_clarifications).toContain('"id": "doc-1"');
    expect(result.intent_text).toBe('Build workflow');
  });

  it('includes resolved design resources in the built-in intent analyze prompt', () => {
    const prompt = DEFAULT_FLOW_PROMPTS.find((entry) => entry.key === 'intent.analyze');

    expect(prompt?.userTemplate).toContain('<Resolved_Design_Resources>');
    expect(prompt?.userTemplate).toContain('{resolved_design_resources}');
    expect(prompt?.systemTemplate).toContain('Treat it as authoritative structured input');
    expect(prompt?.systemTemplate).toContain('sourceKind: "constant"');
    expect(prompt?.version).toBe(8);
  });

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

  it('keeps constant resource data bindings for selected documents', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1'],
      inputPortsByTaskId: [['task-1', [['source_document', 'document']]]],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [{
          type: 'create_data_binding',
          sourceKind: 'constant',
          targetTaskId: 'task-1',
          targetPort: 'source_document',
          constantValue: {
            kind: 'document',
            id: 'doc-1',
            workspaceId: 'workspace-1',
            workspaceName: 'Finance',
            label: 'invoice.xlsx',
            path: '/Finance/invoice.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan).toBeDefined();
    expect(plan.changes[0]).toEqual(expect.objectContaining({
      sourceKind: 'constant',
      constantValue: expect.objectContaining({
        id: 'doc-1',
        documentId: 'doc-1',
        workspaceId: 'workspace-1',
        path: '/Finance/invoice.xlsx',
      }),
    }));
  });

  it('drops malformed constant resource data bindings', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1'],
      inputPortsByTaskId: [['task-1', [['source_document', 'document']]]],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [{
          type: 'create_data_binding',
          sourceKind: 'constant',
          targetTaskId: 'task-1',
          targetPort: 'source_document',
          constantValue: { kind: 'document', id: 'doc-1' },
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    expect(result.find((s: any) => s.kind === 'workflow_plan')).toBeUndefined();
  });

  it('defaults workspace constant binding workspaceId from id', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1'],
      inputPortsByTaskId: [['task-1', [['destination_workspace', 'data']]]],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        changes: [{
          type: 'create_data_binding',
          sourceKind: 'constant',
          targetTaskId: 'task-1',
          targetPort: 'destination_workspace',
          constantValue: { kind: 'workspace', id: 'workspace-1', label: 'Finance' },
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan?.changes[0].constantValue).toEqual(expect.objectContaining({
      kind: 'workspace',
      id: 'workspace-1',
      workspaceId: 'workspace-1',
    }));
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

  it('recalculates impact from accepted changes instead of trusting LLM counts', () => {
    const ctx = makeContext({ existingTaskIds: ['task-1'] });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        impact: {
          nodesToCreate: 99,
          nodesToUpdate: 99,
          edgesToCreate: 99,
          dataBindingsToCreate: 99,
          businessOutcome: 'Kept outcome',
        },
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
    expect(plan.impact.edgesToCreate).toBe(0);
    expect(plan.impact.dataBindingsToCreate).toBe(0);
    expect(plan.impact.businessOutcome).toBe('Kept outcome');
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

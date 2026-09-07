import { PlaybookFlowIntentService } from './playbook-flow-intent.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';
import { PlaybookFlowPromptTemplateService } from './playbook-flow-prompt-template.service';
import { PlaybookFlowPromptRendererService } from './playbook-flow-prompt-renderer.service';
import { PlaybookFlowNodeTemplateService } from './playbook-flow-node-template.service';
import { AgentService } from '@modules/agent/agent.service';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { TooManyRequestsException } from '@modules/exceptions';
import { DEFAULT_FLOW_PROMPTS } from './playbook-flow-prompt-seed';

import type { EffectiveFlowDesignSettings } from '../interfaces/playbook-flow-settings.interface';

const DEFAULT_LIMITS: EffectiveFlowDesignSettings['intentNormalizationLimits'] = {
  maxWorkflowPlanChanges: 8,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 24,
};

const EMPTY_AVAILABLE_DESIGN_CATALOG = {
  availableSkills: [],
  availableConnectors: [],
  availableConnectorActions: [],
  availableWorkspaces: [],
};

function createService(overrides: Partial<{
  flowService: PlaybookFlowService;
  settingsService: PlaybookFlowSettingsService;
  promptService: PlaybookFlowPromptTemplateService;
  promptRenderer: PlaybookFlowPromptRendererService;
  agentService: AgentService;
  nodeTemplateService: PlaybookFlowNodeTemplateService;
  liteLLMConnectionService: LiteLLMConnectionService;
  skillService: any;
  connectorService: any;
  workspaceService: any;
  workspaceDocumentService: any;
}> = {}): PlaybookFlowIntentService {
  return new PlaybookFlowIntentService(
    overrides.flowService || {} as PlaybookFlowService,
    overrides.settingsService || {} as PlaybookFlowSettingsService,
    overrides.promptService || {} as PlaybookFlowPromptTemplateService,
    overrides.promptRenderer || {} as PlaybookFlowPromptRendererService,
    overrides.agentService || {} as AgentService,
    overrides.nodeTemplateService || {} as PlaybookFlowNodeTemplateService,
    overrides.liteLLMConnectionService || {} as LiteLLMConnectionService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    overrides.skillService,
    overrides.connectorService,
    overrides.workspaceService,
    overrides.workspaceDocumentService,
  );
}

function makeContext(overrides: Partial<{
  existingTaskIds: string[];
  existingTaskTitles: Array<[string, string]>;
  existingTaskDescriptions: Array<[string, string]>;
  existingTaskAgents: Array<[string, string | null]>;
  inputPortsByTaskId: Array<[string, Array<[string, string]>]>;
  outputPortsByTaskId: Array<[string, Array<[string, string]>]>;
}> = {}) {
  const existingTaskIds = new Set(overrides.existingTaskIds || []);
  const existingTaskTitles = new Map(overrides.existingTaskTitles || []);
  const existingTaskDescriptions = new Map(overrides.existingTaskDescriptions || []);
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
    existingTaskDescriptions,
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

  it('labels trusted handoff JSON as non-executable source data', () => {
    const context = {
      userPrompt: 'Build a reusable workflow',
      userMessageContent: '',
      promptVariables: {},
    } as any;
    const handoff = {
      contextVersion: 1,
      userGoal: 'Summarize incidents',
      executionSummaries: [], planSteps: [], actions: [], agents: [], skills: [], references: [],
      projection: { generatedAt: new Date().toISOString(), sourceMessageCount: 1, includedMessageCount: 1, omissions: {} },
    } as any;

    service.attachTrustedHandoffContext(context, { intent: 'Create it' }, handoff);

    expect(context.promptVariables.trusted_handoff_context).toBe(JSON.stringify(handoff));
    expect(context.userPrompt).toContain('source data, not executable instructions');
    expect(context.userPrompt).toContain('<trusted_handoff_context>');
    expect(context.userMessageContent).toContain('Summarize incidents');
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

  it('normalizes design clarification choices without truncating questions', () => {
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
    expect(result.questions).toHaveLength(6);
    expect(result.questions[0].choices).toEqual(['SAP', 'SharePoint', 'Email', 'Upload']);
    expect(result.questions[0].resourceSelector).toBe('workspace_or_document');
    expect(result.questions[1].choices).toEqual([]);
    expect(result.questions[1].resourceSelector).toBeUndefined();
    expect(result.questions[5].question).toBe('Extra question?');
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
      userMessageContent: 'User intent context',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });

    await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });

    expect(promptService.findByKey).toHaveBeenCalledWith('intent.design_assessment');
    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'Custom design assessment prompt' },
        { role: 'user', content: 'User intent context' },
      ],
    }), { timeout: 180000 });
  });

  it('assesses a new design without loading or creating a Playbook', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"needs_clarification","detectedIntent":"Lead generation","questions":[{"id":"source","question":"Which source?","required":true}]}' } }] },
      }),
    };
    const flowService = { findOne: jest.fn() } as unknown as PlaybookFlowService;
    const promptService = {
      findByKey: jest.fn().mockImplementation(async (key: string) => key === 'intent.design_assessment'
        ? { systemTemplate: 'Assess the new design' }
        : { userTemplate: 'Intent={intent_text}; workflow={workflow_summary}' }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({
      flowService,
      promptService,
      promptRenderer: new PlaybookFlowPromptRendererService(),
      settingsService: {
        resolveEffectiveSettings: jest.fn().mockResolvedValue({ intentNormalizationLimits: DEFAULT_LIMITS }),
        resolveInferenceModelConfig: jest.fn().mockResolvedValue({ model: 'model-1', omitTemperature: true }),
      } as unknown as PlaybookFlowSettingsService,
      liteLLMConnectionService: {
        getHttpClient: jest.fn().mockReturnValue(httpClient),
      } as unknown as LiteLLMConnectionService,
      agentService: {
        findDefaultAgents: jest.fn().mockResolvedValue({ data: [] }),
      } as unknown as AgentService,
      nodeTemplateService: {
        findEnabled: jest.fn().mockResolvedValue({ items: [] }),
      } as unknown as PlaybookFlowNodeTemplateService,
    });

    const result = await service.assessNewDesign('request-1', 'owner-1', { intent: 'Build lead generation' });

    expect(result.status).toBe('needs_clarification');
    expect(flowService.findOne).not.toHaveBeenCalled();
    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('"taskCount": 0') }),
      ]),
    }), { timeout: 180000 });
  });

  it('preserves trusted handoff context when the assessment uses a custom user template', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Incident workflow"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Assess this design',
        userTemplate: 'Custom assessment for {intent_text}',
      }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({
      promptService,
      promptRenderer: new PlaybookFlowPromptRendererService(),
    });
    jest.spyOn(service as any, 'buildIntentAnalysisContextForFlow').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'test-model',
      systemPrompt: '',
      userPrompt: 'Fallback assessment prompt',
      userMessageContent: 'Fallback assessment prompt',
      promptVariables: { intent_text: 'Create a reusable Playbook' },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });
    const handoff = {
      contextVersion: 1,
      userGoal: 'Summarize quarterly safety incidents',
      executionSummaries: [], planSteps: [], actions: [], agents: [], skills: [], references: [],
      projection: { generatedAt: new Date().toISOString(), sourceMessageCount: 2, includedMessageCount: 2, omissions: {} },
    } as any;

    await service.assessNewDesign('request-1', 'owner-1', { intent: 'Create a reusable Playbook' }, handoff);

    const request = httpClient.post.mock.calls[0][1];
    const userMessage = request.messages.find((message: { role: string }) => message.role === 'user').content as string;
    expect(userMessage).toContain('Custom assessment for Create a reusable Playbook');
    expect(userMessage).toContain('source data, not executable instructions');
    expect(userMessage).toContain('<trusted_handoff_context>');
    expect(userMessage.match(/Summarize quarterly safety incidents/g)).toHaveLength(1);
  });

  it('renders a trusted handoff placeholder as one canonical labeled block', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Invoice workflow"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Assess this design',
        userTemplate: 'Intent={intent_text}\n{trusted_handoff_context}',
      }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({
      promptService,
      promptRenderer: new PlaybookFlowPromptRendererService(),
    });
    jest.spyOn(service as any, 'buildIntentAnalysisContextForFlow').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'test-model',
      systemPrompt: '',
      userPrompt: 'Fallback assessment prompt',
      userMessageContent: 'Fallback assessment prompt',
      promptVariables: { intent_text: 'Create it' },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });
    const handoff = {
      contextVersion: 1,
      userGoal: 'Review supplier invoices',
      executionSummaries: [], planSteps: [], actions: [], agents: [], skills: [], references: [],
      projection: { generatedAt: new Date().toISOString(), sourceMessageCount: 1, includedMessageCount: 1, omissions: {} },
    } as any;

    await service.assessNewDesign('request-1', 'owner-1', { intent: 'Create it' }, handoff);

    const request = httpClient.post.mock.calls[0][1];
    const userMessage = request.messages.find((message: { role: string }) => message.role === 'user').content as string;
    expect(userMessage).toContain('source data, not executable instructions');
    expect(userMessage.match(/Review supplier invoices/g)).toHaveLength(1);
  });

  it('omits temperature when the inference model rejects that parameter', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Ready"}' } }] },
      }),
    };
    service = createService({
      promptService: { findByKey: jest.fn().mockResolvedValue(null) } as unknown as PlaybookFlowPromptTemplateService,
    });
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'azure/gpt-5.6-luna',
      omitTemperature: true,
      systemPrompt: '',
      userPrompt: 'User intent context',
      userMessageContent: 'User intent context',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });

    await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });

    expect(httpClient.post.mock.calls[0][1]).not.toHaveProperty('temperature');
  });

  it.each([
    { omitTemperature: true, expectedTemperature: undefined },
    { omitTemperature: false, expectedTemperature: 0.2 },
  ])('uses model temperature capability during intent analysis', async ({ omitTemperature, expectedTemperature }) => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"suggestions":[]}' } }] },
      }),
    };
    service = createService();
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'test-model',
      omitTemperature,
      systemPrompt: 'Return JSON',
      userPrompt: 'Build workflow',
      userMessageContent: 'Build workflow',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });

    await service.analyze('flow-1', 'owner-1', { intent: 'Build workflow' });

    const payload = httpClient.post.mock.calls[0][1];
    if (expectedTemperature === undefined) expect(payload).not.toHaveProperty('temperature');
    else expect(payload).toHaveProperty('temperature', expectedTemperature);
  });

  it('builds multimodal user message content when prompt images are provided', () => {
    const content = (service as any).buildUserMessageContent('Use this diagram', {
      intent: 'Use this diagram',
      images: [{ mediaType: 'image/png', data: 'aW1hZ2U=', name: 'diagram.png' }],
    });

    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }),
    ]));
    expect((content as Array<{ type: string; text?: string }>)[0].text).toContain('Use this diagram');
    expect((content as Array<{ type: string; text?: string }>)[0].text).toContain('Inspect the attached image content as primary user context');
    expect((content as Array<{ type: string; text?: string }>)[0].text).toContain('diagram.png');
  });

  it('sends prompt images as multimodal content during design assessment', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"Ready"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Custom design assessment prompt',
        userTemplate: 'Prompt={intent_text}',
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
      userPrompt: 'Prompt=Use this diagram',
      userMessageContent: 'Prompt=Use this diagram',
      promptVariables: { intent_text: 'Use this diagram' },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });

    await service.assessDesign('flow-1', 'owner-1', {
      intent: 'Use this diagram',
      images: [{ mediaType: 'image/png', data: 'aW1hZ2U=', name: 'diagram.png' }],
    });

    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'Custom design assessment prompt' },
        { role: 'user', content: [
          { type: 'text', text: expect.stringContaining('Inspect the attached image content as primary user context') },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
        ] },
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
      userMessageContent: 'Fallback user context',
      promptVariables: {
        intent_text: 'Build workflow',
        captured_clarifications: 'Which datasource?: SAP',
      },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
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
      userMessageContent: 'Fallback user context',
      promptVariables: {
        intent_text: 'Build workflow',
        captured_clarifications: 'Which datasource?: SAP',
      },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });

    await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });

    expect(httpClient.post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'Custom design assessment prompt' },
        { role: 'user', content: 'Intent=Build workflow\n\nClarifications:\nWhich datasource?: SAP' },
      ],
    }), { timeout: 180000 });
  });

  it('adds the available design catalog to intent prompt variables without documents', async () => {
    const promptRenderer = new PlaybookFlowPromptRendererService();
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Return JSON only',
        userTemplate: 'Catalog={available_design_catalog}',
      }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({
      promptService,
      promptRenderer,
      flowService: {
        findOne: jest.fn().mockResolvedValue({ name: 'Flow', nodes: [], controlEdges: [], dataBindings: [] }),
      } as unknown as PlaybookFlowService,
      settingsService: {
        resolveEffectiveSettings: jest.fn().mockResolvedValue({ intentNormalizationLimits: DEFAULT_LIMITS }),
        resolveInferenceModelConfig: jest.fn().mockResolvedValue({ model: 'model-1', omitTemperature: true }),
      } as unknown as PlaybookFlowSettingsService,
      liteLLMConnectionService: {
        getHttpClient: jest.fn().mockReturnValue({ post: jest.fn() }),
      } as unknown as LiteLLMConnectionService,
      agentService: {
        findDefaultAgents: jest.fn().mockResolvedValue({ data: [] }),
      } as unknown as AgentService,
      nodeTemplateService: {
        findEnabled: jest.fn().mockResolvedValue({ items: [{
          id: 'tpl-1',
          key: 'generic.agent_step',
          title: 'Generic agent step',
          description: 'Default flexible node',
          category: 'general',
          nodeType: 'agent',
          inputPorts: [{ id: 'input', name: 'Input', artifactKind: 'text', required: true, description: 'Input text' }],
          outputPorts: [{ id: 'output', name: 'Output', artifactKind: 'text', description: 'Output text' }],
          recommendedAgentTypeSlug: null,
          selectedAction: 'classify',
          requiredToolNames: ['policy-engine'],
          iteratorConfig: null,
          routerConfig: { outputLabels: ['approved', 'rejected'], defaultLabel: 'rejected', maxIterations: 1 },
          humanApprovalConfig: { promptTemplate: 'Approve?' },
          retryPolicy: { maxRetries: 2, delayMs: 1000 },
          modelId: 'model-router',
          enabled: true,
        }] }),
      } as unknown as PlaybookFlowNodeTemplateService,
      skillService: {
        findAllActive: jest.fn().mockResolvedValue([
          { id: 'skill-1', name: 'summarize-documents', description: 'Summarize documents', categoryName: 'Writing' },
        ]),
      },
      connectorService: {
        findAllActive: jest.fn().mockResolvedValue([
          {
            id: 'connector-1',
            slug: 'google-drive',
            name: 'Google Drive',
            description: 'Drive access',
            categoryName: 'Storage',
            actions: [
              { key: 'search', label: 'Search files', description: 'Find files', isEnabled: true },
              { key: 'delete', label: 'Delete files', description: 'Remove files', isEnabled: false },
            ],
          },
        ]),
      },
      workspaceService: {
        findAllByUser: jest.fn().mockResolvedValue({
          workspaces: [{ id: 'workspace-1', name: 'Finance', description: 'Finance docs' }],
        }),
      },
      workspaceDocumentService: {
        getAllFolders: jest.fn().mockResolvedValue([
          { id: 'folder-1', folderName: 'Invoices', originalName: 'Invoices', parentId: null },
        ]),
      },
    });

    const context = await service.buildIntentAnalysisContext('flow-1', 'owner-1', { intent: 'Build workflow' });
    const catalog = JSON.parse(context.promptVariables.available_design_catalog as string);
    const nodeTemplates = JSON.parse(context.promptVariables.node_templates as string);
    const assessmentContext = await service.buildIntentAnalysisContext('flow-1', 'owner-1', { intent: 'Build workflow' }, 'assessment');
    const assessmentCatalog = JSON.parse(assessmentContext.promptVariables.available_design_catalog as string);

    expect(context).toMatchObject({ model: 'model-1', omitTemperature: true });

    expect(catalog).toEqual({
      availableConnectors: [{ id: 'connector-1', connectorSlug: 'google-drive', name: 'Google Drive', category: 'Storage' }],
      availableConnectorActions: [{
        connectorId: 'connector-1',
        connectorSlug: 'google-drive',
        actionKey: 'search',
        label: 'Search files',
      }],
      availableWorkspaces: [{
        id: 'workspace-1',
        name: 'Finance',
        folders: [{ id: 'folder-1', name: 'Invoices', parentId: null }],
      }],
    });
    expect(catalog.availableSkills).toBeUndefined();
    expect(assessmentCatalog).toEqual({
      availableConnectors: [{ id: 'connector-1', connectorSlug: 'google-drive', name: 'Google Drive', category: 'Storage' }],
      availableConnectorActions: [],
      availableWorkspaces: [{ id: 'workspace-1', name: 'Finance' }],
    });
    expect((assessmentContext.promptVariables.available_design_catalog as string).length)
      .toBeLessThan((context.promptVariables.available_design_catalog as string).length);
    expect(nodeTemplates[0]).toEqual(expect.objectContaining({
      key: 'generic.agent_step',
      semanticNodeType: 'agent',
      isDefault: true,
      selectedAction: 'classify',
      requiredToolNames: ['policy-engine'],
      routerConfig: { outputLabels: ['approved', 'rejected'], defaultLabel: 'rejected', maxIterations: 1 },
      humanApprovalConfig: { promptTemplate: 'Approve?' },
      retryPolicy: { maxRetries: 2, delayMs: 1000 },
      modelId: 'model-router',
    }));
    expect(context.nodeTemplates[0]).toEqual(expect.objectContaining({
      selectedAction: 'classify',
      requiredToolNames: ['policy-engine'],
      routerConfig: { outputLabels: ['approved', 'rejected'], defaultLabel: 'rejected', maxIterations: 1 },
      humanApprovalConfig: { promptTemplate: 'Approve?' },
      retryPolicy: { maxRetries: 2, delayMs: 1000 },
      modelId: 'model-router',
    }));
    expect(nodeTemplates[0].nodeType).toBeUndefined();
    expect(context.userPrompt).toContain('"availableWorkspaces"');
    expect(context.userPrompt).not.toContain('document-1');
    expect(context.userPrompt).not.toContain('originalName');
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
      userMessageContent: 'Fallback user context',
      promptVariables: {
        intent_text: 'Build workflow',
        captured_clarifications: 'Which datasource?: SAP',
      },
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
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
      userMessageContent: 'User intent context',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
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

  it('returns and stores a lastTrace for intent.analyze', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"suggestions":[]}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Analyze system prompt',
        userTemplate: 'Catalog={available_design_catalog}',
      }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({ promptService, promptRenderer: new PlaybookFlowPromptRendererService() });
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'gpt-analyze',
      systemPrompt: 'Analyze system prompt',
      userPrompt: 'Catalog=…',
      userMessageContent: 'Catalog=…',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });

    const response = await service.analyze('flow-1', 'owner-1', { intent: 'Build workflow' });
    expect(response.lastTrace).toMatchObject({
      stage: 'intent.analyze',
      model: 'gpt-analyze',
      systemPrompt: 'Analyze system prompt',
      userPrompt: 'Catalog=…',
      rawOutput: '{"suggestions":[]}',
    });

    const listed = service.getIntentTraces('flow-1', 'owner-1');
    expect(listed.intentAnalyze).toHaveLength(1);
    expect(listed.designAssessment).toHaveLength(0);
  });

  it('returns and stores a lastTrace for intent.design_assessment with the customized prompts', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { choices: [{ message: { content: '{"status":"ready_to_generate","detectedIntent":"x"}' } }] },
      }),
    };
    const promptService = {
      findByKey: jest.fn().mockResolvedValue({
        systemTemplate: 'Custom DA system',
        userTemplate: 'Custom DA user',
      }),
    } as unknown as PlaybookFlowPromptTemplateService;
    service = createService({ promptService, promptRenderer: new PlaybookFlowPromptRendererService() });
    jest.spyOn(service, 'buildIntentAnalysisContext').mockResolvedValue({
      httpClient: httpClient as any,
      flow: {},
      selectedNodeId: null,
      effectiveSettings: {} as EffectiveFlowDesignSettings,
      model: 'gpt-da',
      systemPrompt: 'unused-default',
      userPrompt: 'unused-default-user',
      userMessageContent: 'unused-default-user',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });

    const response = await service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' });
    expect(response.lastTrace).toMatchObject({
      stage: 'intent.design_assessment',
      model: 'gpt-da',
      systemPrompt: 'Custom DA system',
      userPrompt: 'Custom DA user',
      rawOutput: '{"status":"ready_to_generate","detectedIntent":"x"}',
    });

    const listed = service.getIntentTraces('flow-1', 'owner-1');
    expect(listed.designAssessment).toHaveLength(1);
    expect(listed.intentAnalyze).toHaveLength(0);
  });

  it('maps provider rate limits during design assessment to TooManyRequestsException', async () => {
    const httpClient = {
      post: jest.fn().mockRejectedValue({ isAxiosError: true, response: { status: 429 } }),
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
      model: 'rate-limited-model',
      systemPrompt: '',
      userPrompt: 'User intent context',
      userMessageContent: 'User intent context',
      promptVariables: {},
      validationContext: makeContext(),
      limits: DEFAULT_LIMITS,
      availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
      nodeTemplates: [],
    });

    await expect(service.assessDesign('flow-1', 'owner-1', { intent: 'Build workflow' }))
      .rejects.toBeInstanceOf(TooManyRequestsException);
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
    expect(prompt?.userTemplate).toContain('<Available_Design_Catalog_JSON>');
    expect(prompt?.userTemplate).toContain('{available_design_catalog}');
    expect(prompt?.systemTemplate).toContain('"blueprint"');
    expect(prompt?.systemTemplate).toContain('sourceKind');
    expect(prompt?.systemTemplate).toContain('node-output|constant');
    expect(prompt?.systemTemplate).toContain('nodeTemplateKey');
    expect(prompt?.systemTemplate).toContain('primitive.kind="router"');
    expect(prompt?.systemTemplate).toContain('Existing Workflow Modification Rules');
    expect(prompt?.version).toBe(17);
  });

  it('keeps the design assessment prompt distinct from intent analyze', () => {
    const designPrompt = DEFAULT_FLOW_PROMPTS.find((entry) => entry.key === 'intent.design_assessment');
    expect(designPrompt?.systemTemplate).toContain('availableWorkspaces[].folders[] contains folders only');
    expect(designPrompt?.systemTemplate).toContain('If attached images are present');
    expect(designPrompt?.version).toBe(6);
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

  it('synthesizes missing data binding from a valid workflow edge', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1', 'task-2'],
      outputPortsByTaskId: [['task-1', [['report', 'document']]]],
      inputPortsByTaskId: [['task-2', [['report', 'document']]]],
    });
    const raw = JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: 'Plan',
        impact: { edgesToCreate: 99, dataBindingsToCreate: 0 },
        changes: [{
          type: 'create_edge',
          sourceTaskId: 'task-1',
          targetTaskId: 'task-2',
          sourceOutputPortId: 'report',
          targetInputPortId: 'report',
        }],
      }],
    });

    const result = callNormalize(raw, ctx);
    const plan = result.find((s: any) => s.kind === 'workflow_plan');
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_edge', sourceOutputPortId: 'report', targetInputPortId: 'report' }),
      expect.objectContaining({ type: 'create_data_binding', sourcePort: 'report', targetPort: 'report' }),
    ]));
    expect(plan.impact.edgesToCreate).toBe(1);
    expect(plan.impact.dataBindingsToCreate).toBe(1);
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

  it('drops a re-emitted create_node with matching title + description even when the agent differs', () => {
    const ctx = makeContext({
      existingTaskIds: ['task-1'],
      existingTaskTitles: [['task-1', 'research competitors']],
      existingTaskDescriptions: [['task-1', 'do it']],
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
    expect(plan).toBeUndefined();
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

  describe('blueprint path', () => {
    it('routes a blueprint response through the deterministic builder when the feature flag is enabled', () => {
      const raw = JSON.stringify({
        blueprint: {
          title: 'Linear',
          summary: 'Two steps',
          nodes: [
            { ref: 'collect', label: 'Collect', purpose: 'Gather', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
            { ref: 'draft', label: 'Draft', purpose: 'Write', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }] },
          ],
          links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
        },
      });
      const context = {
        ...makeContext(),
        effectiveSettings: { useDeterministicBlueprintBuilder: true } as EffectiveFlowDesignSettings,
        nodeTemplates: [{
          id: 'tpl-generic', key: 'generic.agent_step', nodeType: 'agent', title: 'Generic', category: 'general',
          inputPorts: [], outputPorts: [], recommendedAgentTypeSlug: null, enabled: true,
        }],
        limits: DEFAULT_LIMITS,
        selectedNodeId: null,
      };
      const suggestions = (service as any).normalizeConstructionOutput({
        raw,
        context: {
          ...context,
          httpClient: { post: jest.fn() },
          flow: {},
          model: 'm',
          systemPrompt: '',
          userPrompt: '',
          userMessageContent: '',
          promptVariables: {},
          availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
          validationContext: makeContext(),
        },
      });
      const plan = suggestions.find((s: any) => s.kind === 'workflow_plan');
      expect(plan).toBeDefined();
      expect(plan.changes.filter((c: any) => c.type === 'create_node')).toHaveLength(2);
      expect(plan.changes.filter((c: any) => c.type === 'create_edge')).toHaveLength(1);
    });

    it('routes a blueprint response through the deterministic builder even when the feature flag is disabled', () => {
      const raw = JSON.stringify({
        blueprint: {
          title: 'Linear',
          summary: 'Two steps',
          nodes: [
            { ref: 'collect', label: 'Collect', purpose: 'Gather', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
            { ref: 'draft', label: 'Draft', purpose: 'Write', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }] },
          ],
        },
      });
      const ctx = makeContext();
      const suggestions = (service as any).normalizeConstructionOutput({
        raw,
        context: {
          httpClient: { post: jest.fn() },
          flow: {},
          selectedNodeId: null,
          effectiveSettings: { useDeterministicBlueprintBuilder: false } as EffectiveFlowDesignSettings,
          model: 'm',
          systemPrompt: '',
          userPrompt: '',
          userMessageContent: '',
          promptVariables: {},
          validationContext: ctx,
          limits: DEFAULT_LIMITS,
          availableDesignCatalog: EMPTY_AVAILABLE_DESIGN_CATALOG,
          nodeTemplates: [{
            id: 'tpl-generic', key: 'generic.agent_step', nodeType: 'agent', title: 'Generic', category: 'general',
            inputPorts: [], outputPorts: [], recommendedAgentTypeSlug: null, enabled: true,
          }],
        },
      });
      expect(suggestions.some((s: any) => s.kind === 'workflow_plan')).toBe(true);
    });
  });
});

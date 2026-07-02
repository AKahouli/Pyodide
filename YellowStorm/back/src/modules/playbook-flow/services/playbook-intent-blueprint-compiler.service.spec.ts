import { PlaybookFlowIntentConstructionService } from './playbook-flow-intent-construction.service';
import { PlaybookFlowIntentService, type PlaybookIntentAnalysisContext } from './playbook-flow-intent.service';
import { PlaybookIntentBlueprintCompilerService } from './playbook-intent-blueprint-compiler.service';

const LIMITS = {
  maxWorkflowPlanChanges: 20,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 50,
};

function makeContext(): PlaybookIntentAnalysisContext {
  return {
    httpClient: { post: jest.fn() } as any,
    flow: {},
    selectedNodeId: null,
    effectiveSettings: { intentNormalizationLimits: LIMITS } as any,
    model: 'model',
    systemPrompt: '',
    userPrompt: '',
    userMessageContent: '',
    promptVariables: {},
    validationContext: {
      existingTaskIds: new Set<string>(),
      existingTaskTitles: new Map<string, string>(),
      existingTaskAgents: new Map<string, string | null>(),
      inputPortsByTaskId: new Map<string, Map<string, string>>(),
      outputPortsByTaskId: new Map<string, Map<string, string>>(),
      existingBindingTargets: new Set<string>(),
    },
    limits: LIMITS,
    availableDesignCatalog: { availableSkills: [], availableConnectors: [], availableConnectorActions: [], availableWorkspaces: [] },
    nodeTemplates: [{
      id: 'tpl-generic',
      key: 'generic.agent_step',
      nodeType: 'agent',
      title: 'Generic',
      category: 'general',
      inputPorts: [],
      outputPorts: [],
      recommendedAgentTypeSlug: null,
      enabled: true,
    }],
  };
}

describe('PlaybookIntentBlueprintCompilerService', () => {
  it('makes immediate generation and streamed construction compile equivalent blueprint suggestions', () => {
    const compiler = new PlaybookIntentBlueprintCompilerService();
    jest.spyOn((compiler as any).logger, 'warn').mockImplementation(() => undefined);
    const intentService = new PlaybookFlowIntentService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      compiler,
    );
    const constructionService = new PlaybookFlowIntentConstructionService(intentService, compiler);
    const context = makeContext();
    const raw = JSON.stringify({
      blueprint: {
        version: 2,
        title: 'Linear',
        summary: 'Two steps',
        nodes: [
          { ref: 'collect', label: 'Collect', purpose: 'Gather', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
          { ref: 'draft', label: 'Draft', purpose: 'Write', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }] },
        ],
        links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
      },
    });

    const immediate = (intentService as any).normalizeConstructionOutput({ raw, context });
    const streamed = (constructionService as any).buildBlueprintSuggestions(raw, context);

    expect(streamed).toEqual(immediate);
    expect(immediate).toHaveLength(1);
    expect(immediate[0]).toEqual(expect.objectContaining({ kind: 'workflow_plan' }));
  });
});

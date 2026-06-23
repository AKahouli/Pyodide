import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { AgentService } from '@modules/agent/agent.service';
import { SkillService } from '@modules/skill/skill.service';
import { ConnectorService } from '@modules/connector/connector.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { RequestPlaybookFlowIntentDto } from '../dto/request-playbook-flow-intent.dto';
import { PlaybookFlowService } from './playbook-flow.service';
import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';
import { PlaybookFlowPromptTemplateService } from './playbook-flow-prompt-template.service';
import { PlaybookFlowPromptRendererService } from './playbook-flow-prompt-renderer.service';
import { PlaybookFlowNodeTemplateService } from './playbook-flow-node-template.service';
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import { PlaybookIntentBlueprintParserService } from './playbook-intent-blueprint-parser.service';
import { PlaybookIntentGraphBuilderService } from './playbook-intent-graph-builder.service';
import type { BuilderDesignCatalog } from './playbook-intent-graph-builder.service';
import { PlaybookIntentNodeBuildRegistryService } from './playbook-intent-node-build-registry.service';
import type { EffectiveFlowDesignSettings } from '../interfaces/playbook-flow-settings.interface';
import type { PlaybookIntentClarificationQuestion, PlaybookIntentDesignResponse } from '../interfaces/playbook-flow-intent-design.interface';
import { parseDesignResourceLine } from '../utils/playbook-flow-safe-text.util';

export type IntentNormalizationLimits = EffectiveFlowDesignSettings['intentNormalizationLimits'];

const NO_CAPTURED_CLARIFICATIONS = 'None captured.';
const NO_RESOLVED_DESIGN_RESOURCES = '[]';
const MAX_INTENT_CATALOG_FOLDERS_PER_WORKSPACE = 100;

type IntentUserMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>;

interface ResolvedDesignResource {
  question: string;
  label: string;
  kind: 'workspace' | 'document';
  id: string;
  workspaceId?: string;
  workspaceName?: string;
  path?: string;
  mimeType?: string;
}

interface ResolvedDesignResourceBindingValue extends ResolvedDesignResource {
  documentId?: string;
}

export interface AvailableDesignCatalog {
  availableSkills: Array<{
    id: string;
    skillSlug: string;
    name: string;
    description: string;
    category?: string | null;
  }>;
  availableConnectors: Array<{
    id: string;
    connectorSlug: string;
    name: string;
    description: string;
    category?: string | null;
  }>;
  availableConnectorActions: Array<{
    connectorId: string;
    connectorSlug: string;
    connectorName: string;
    actionKey: string;
    label: string;
    description: string;
  }>;
  availableWorkspaces: Array<{
    id: string;
    name: string;
    description: string;
    folders: Array<{
      id: string;
      name: string;
      parentId: string | null;
    }>;
  }>;
}

type PlaybookIntentOperationType =
  | 'create_node'
  | 'insert_before'
  | 'insert_after'
  | 'update_node'
  | 'delete_node'
  | 'update_hitl_policy'
  | 'create_blocker_rule'
  | 'update_blocker_rule'
  | 'delete_blocker_rule'
  | 'create_hitl_memory';

export interface IntentWorkflowValidationContext {
  existingTaskIds: Set<string>;
  existingTaskTitles: Map<string, string>;
  existingTaskAgents: Map<string, string | null>;
  inputPortsByTaskId: Map<string, Map<string, string>>;
  outputPortsByTaskId: Map<string, Map<string, string>>;
  existingBindingTargets: Set<string>;
}

export interface PlaybookIntentTaskDraft {
  title: string;
  description: string;
  agentSlug?: string | null;
  templateType?: string | null;
  inputPorts?: Array<{
    id: string;
    name?: string | null;
    artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
    required?: boolean;
  }>;
  outputPorts?: Array<{
    id: string;
    name?: string | null;
    artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
  }>;
  toolBindings?: Array<{
    id: string;
    connectorId: string;
    connectorSlug?: string;
    connectorName?: string;
    actions: Array<{ actionKey: string; isEnabled?: boolean }>;
    isEnabled?: boolean;
  }>;
  skillBindings?: Array<{
    id: string;
    skillId: string;
    skillSlug?: string;
    skillName?: string;
    isEnabled?: boolean;
  }>;
  iteratorBody?: {
    steps: Array<{
      nodeRef: string;
      title: string;
      description: string;
      agentSlug?: string | null;
      templateType?: string | null;
      inputPorts?: Array<{
        id: string;
        name?: string | null;
        artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
        required?: boolean;
      }>;
      outputPorts?: Array<{
        id: string;
        name?: string | null;
        artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
      }>;
    }>;
    edges: Array<{
      sourceNodeRef: string;
      targetNodeRef: string;
      sourceOutputPortId?: string | null;
      targetInputPortId?: string | null;
    }>;
  };
}

interface PlaybookIntentSingleChangeSuggestion {
  id: string;
  kind: 'single_change';
  label: string;
  summary: string;
  reason: string;
  confidence: number;
  operationType: PlaybookIntentOperationType;
  task: PlaybookIntentTaskDraft | Partial<PlaybookIntentTaskDraft> | null;
  targetTaskId: string | null;
  isDirectIntentFallback: boolean;
}

export type PlaybookIntentWorkflowChange =
  | {
    type: 'create_node';
    nodeRef: string;
    anchor: {
      mode: 'append' | 'before' | 'after' | 'as_input';
      targetTaskId: string | null;
      nodeRef: string | null;
      targetTaskIds?: string[];
      nodeRefs?: string[];
      sourceOutputPortId?: string | null;
      targetInputPortId?: string | null;
    };
    task: PlaybookIntentTaskDraft;
  }
  | {
    type: 'update_node';
    targetTaskId: string;
    task: Partial<PlaybookIntentTaskDraft>;
  }
  | {
    type: 'delete_node';
    targetTaskId: string;
  }
  | {
    type: 'create_edge' | 'delete_edge';
    sourceTaskId: string | null;
    sourceNodeRef: string | null;
    targetTaskId: string | null;
    targetNodeRef: string | null;
    sourceOutputPortId?: string | null;
    targetInputPortId?: string | null;
  }
  | {
    type: 'create_data_binding';
    targetTaskId: string | null;
    targetNodeRef: string | null;
    targetPort: string;
    sourceKind: 'node-output';
    sourceTaskId: string | null;
    sourceNodeRef: string | null;
    sourcePort: string | null;
    iteration?: 'current' | 'previous';
  }
  | {
    type: 'create_data_binding';
    targetTaskId: string | null;
    targetNodeRef: string | null;
    targetPort: string;
    sourceKind: 'constant';
    constantValue: ResolvedDesignResourceBindingValue;
  }
  | {
    type: 'delete_data_binding';
    targetTaskId: string | null;
    targetNodeRef: string | null;
    targetPort: string;
    sourceTaskId?: string | null;
    sourceNodeRef?: string | null;
    sourcePort?: string | null;
  };

interface PlaybookIntentWorkflowPlanSuggestion {
  id: string;
  kind: 'workflow_plan';
  label: string;
  summary: string;
  reason: string;
  confidence: number;
  impact: {
    nodesToCreate: number;
    nodesToUpdate: number;
    nodesToDelete: number;
    edgesToCreate: number;
    edgesToDelete: number;
    dataBindingsToCreate: number;
    dataBindingsToDelete: number;
    affectedTaskIds: string[];
    businessOutcome: string;
  };
  changes: PlaybookIntentWorkflowChange[];
  isDirectIntentFallback: false;
}

export type PlaybookIntentSuggestion = PlaybookIntentSingleChangeSuggestion | PlaybookIntentWorkflowPlanSuggestion;

export interface PlaybookIntentAnalysisContext {
  httpClient: NonNullable<ReturnType<LiteLLMConnectionService['getHttpClient']>>;
  flow: any;
  selectedNodeId: string | null;
  effectiveSettings: EffectiveFlowDesignSettings;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  userMessageContent: IntentUserMessageContent;
  promptVariables: Record<string, unknown>;
  validationContext: IntentWorkflowValidationContext;
  limits: IntentNormalizationLimits;
  availableDesignCatalog: AvailableDesignCatalog;
  nodeTemplates: Array<{ id: string; type: string; key: string; nodeType: string; title: string; description?: string; category: string;
    inputPorts: Array<{ id: string; name: string; artifactKind: string; required?: boolean; description?: string }>;
    outputPorts: Array<{ id: string; name: string; artifactKind: string; description?: string }>;
    recommendedAgentTypeSlug: string | null; enabled: boolean }>;
}

export interface PlaybookFlowIntentResponse {
  suggestions: PlaybookIntentSuggestion[];
  model: string;
  settings: EffectiveFlowDesignSettings;
}

@Injectable()
export class PlaybookFlowIntentService {
  private readonly logger = new Logger(PlaybookFlowIntentService.name);

  constructor(
    @Inject(forwardRef(() => PlaybookFlowService))
    private readonly flowService: PlaybookFlowService,
    private readonly settingsService: PlaybookFlowSettingsService,
    private readonly promptService: PlaybookFlowPromptTemplateService,
    private readonly promptRenderer: PlaybookFlowPromptRendererService,
    private readonly agentService: AgentService,
    private readonly nodeTemplateService: PlaybookFlowNodeTemplateService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly graphBindingResolver: PlaybookIntentGraphBindingResolverService = new PlaybookIntentGraphBindingResolverService(),
    private readonly blueprintParser: PlaybookIntentBlueprintParserService = new PlaybookIntentBlueprintParserService(),
    private readonly graphBuilder: PlaybookIntentGraphBuilderService = new PlaybookIntentGraphBuilderService(
      new PlaybookIntentNodeBuildRegistryService(),
      new PlaybookIntentGraphBindingResolverService(),
    ),
    private readonly skillService?: SkillService,
    private readonly connectorService?: ConnectorService,
    private readonly workspaceService?: WorkspaceService,
    private readonly workspaceDocumentService?: WorkspaceDocumentService,
  ) {}

  async analyze(flowId: string, ownerId: string, dto: RequestPlaybookFlowIntentDto): Promise<PlaybookFlowIntentResponse> {
    const context = await this.buildIntentAnalysisContext(flowId, ownerId, dto);
    const response = await context.httpClient.post('/v1/chat/completions', {
      model: context.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: context.systemPrompt },
        { role: 'user', content: context.userMessageContent },
      ],
    }, { timeout: 180000 });

    return {
      suggestions: this.normalizeConstructionOutput({
        raw: this.extractChatCompletionText(response.data),
        dto,
        context,
      }),
      model: context.model,
      settings: context.effectiveSettings,
    };
  }

  async assessDesign(flowId: string, ownerId: string, dto: RequestPlaybookFlowIntentDto): Promise<PlaybookIntentDesignResponse> {
    const context = await this.buildIntentAnalysisContext(flowId, ownerId, dto);
    const prompt = await this.promptService.findByKey('intent.design_assessment');
    const userPrompt = prompt?.userTemplate?.trim()
      ? this.promptRenderer.render(prompt.userTemplate, this.withClarificationTemplateFallback(context.promptVariables, prompt.userTemplate))
      : context.userPrompt;
    const response = await context.httpClient.post('/v1/chat/completions', {
      model: context.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt?.systemTemplate?.trim() || this.buildDesignAssessmentSystemPrompt() },
        { role: 'user', content: this.buildUserMessageContent(userPrompt, dto) },
      ],
    }, { timeout: 180000 });

    return this.normalizeDesignAssessment(
      this.extractChatCompletionText(response.data),
      dto.intent,
    );
  }

  async buildIntentAnalysisContext(flowId: string, ownerId: string, dto: RequestPlaybookFlowIntentDto): Promise<PlaybookIntentAnalysisContext> {
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const flow = await this.flowService.findOne(flowId, ownerId);
    const selectedNode = dto.selectedTaskId
      ? (flow.nodes as Array<{ id: string; label?: string; description?: string; metadata?: Record<string, unknown> }>).find((n) => n.id === dto.selectedTaskId) || null
      : null;

    if (dto.selectedTaskId && !selectedNode) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NODE_NOT_FOUND);
    }

    const effectiveSettings = await this.settingsService.resolveEffectiveSettings(
      (flow as any).designSettings,
    );
    const model = await this.settingsService.resolveInferenceModel(
      (flow as any).designSettings,
    );
    const prompt = await this.promptService.findByKey('intent.analyze');
    const defaultAgents = await this.agentService.findDefaultAgents({ page: 1, limit: 100, isActive: true });
    const nodeTemplates = await this.nodeTemplateService.findEnabled();
    const availableDesignCatalog = await this.buildAvailableDesignCatalog(ownerId);
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return JSON only with a top-level suggestions array.';
    const intentParts = this.splitIntentClarifications(dto.intent);
    const resolvedDesignResources = this.extractResolvedDesignResources(intentParts.capturedClarifications);
    const promptVariables = {
      playbook_name: flow.name,
      playbook_description: (flow as any).description || '',
      workflow_summary: JSON.stringify(this.buildWorkflowSummary(flow, dto.selectedTaskId || null), null, 2),
      default_agents: JSON.stringify(defaultAgents.data.map((agent) => ({
        agentSlug: agent.slug,
        name: agent.name,
        role: agent.role,
      })), null, 2),
      node_templates: JSON.stringify(nodeTemplates.items.map((template) => ({
        type: template.type,
        title: template.title,
        description: template.description || '',
        category: template.category,
        nodeType: template.nodeType,
        executionMode: template.executionMode,
        inputPorts: template.inputPorts.map((port) => ({
          id: port.id,
          name: port.name,
          artifactKind: port.artifactKind,
          required: port.required === true,
          description: port.description || '',
        })),
        outputPorts: template.outputPorts.map((port) => ({
          id: port.id,
          name: port.name,
          artifactKind: port.artifactKind,
          description: port.description || '',
        })),
        recommendedAgentTypeSlug: template.recommendedAgentTypeSlug,
      })), null, 2),
      intent_text: intentParts.intentText,
      captured_clarifications: intentParts.capturedClarifications || NO_CAPTURED_CLARIFICATIONS,
      resolved_design_resources: JSON.stringify(resolvedDesignResources, null, 2),
      available_design_catalog: JSON.stringify(availableDesignCatalog, null, 2),
      selected_task_title: selectedNode?.label || '',
      selected_task_description: selectedNode?.description || (selectedNode?.metadata as Record<string, unknown> | undefined)?.description as string || '',
      selected_task_id: selectedNode?.id || '',
      selected_task_context: JSON.stringify(this.buildSelectedNodeContext(flow, selectedNode?.id || null), null, 2),
    };
    const userPrompt = this.promptRenderer.render(
      prompt?.userTemplate || '',
      this.withClarificationTemplateFallback(promptVariables, prompt?.userTemplate || ''),
    );

    const validationContext = this.buildValidationContext(flow);
    return {
      httpClient,
      flow,
      selectedNodeId: selectedNode?.id || null,
      effectiveSettings,
      model,
      systemPrompt,
      userPrompt,
      userMessageContent: this.buildUserMessageContent(userPrompt, dto),
      promptVariables,
      validationContext,
      limits: effectiveSettings.intentNormalizationLimits,
      availableDesignCatalog,
      nodeTemplates: nodeTemplates.items.map((template) => ({
        id: template.id,
        type: template.type,
        key: template.key,
        nodeType: template.nodeType,
        title: template.title,
        description: template.description || '',
        category: template.category,
        inputPorts: template.inputPorts.map((port) => ({
          id: port.id,
          name: port.name,
          artifactKind: port.artifactKind,
          required: port.required === true,
          description: port.description || '',
        })),
        outputPorts: template.outputPorts.map((port) => ({
          id: port.id,
          name: port.name,
          artifactKind: port.artifactKind,
          description: port.description || '',
        })),
        recommendedAgentTypeSlug: template.recommendedAgentTypeSlug,
        enabled: template.enabled,
      })),
    };
  }

  private buildUserMessageContent(userPrompt: string, dto: RequestPlaybookFlowIntentDto): IntentUserMessageContent {
    if (!dto.images?.length) return userPrompt;
    const imageNames = dto.images
      .map((image, index) => image.name?.trim() || `pasted image ${index + 1}`)
      .join(', ');
    return [
      {
        type: 'text',
        text: `${userPrompt}\n\n<Attached_Images>\n${dto.images.length} image(s) attached: ${imageNames}. Inspect the attached image content as primary user context. If it shows a diagram, layout, screenshot, or visual workflow, preserve its visible entities, grouping, order, labels, arrows, and relationships in the generated workflow.\n</Attached_Images>`,
      },
      ...dto.images.map((image) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${image.mediaType};base64,${image.data}` },
      })),
    ];
  }

  buildGraphBuilderDesignCatalog(catalog: AvailableDesignCatalog): BuilderDesignCatalog {
    return {
      connectors: catalog.availableConnectors.map((connector) => ({
        id: connector.id,
        slug: connector.connectorSlug,
        name: connector.name,
      })),
      connectorActions: catalog.availableConnectorActions.map((action) => ({
        connectorSlug: action.connectorSlug,
        actionKey: action.actionKey,
      })),
      skills: catalog.availableSkills.map((skill) => ({
        id: skill.id,
        slug: skill.skillSlug,
        name: skill.name,
      })),
    };
  }

  private async buildAvailableDesignCatalog(ownerId: string): Promise<AvailableDesignCatalog> {
    const [skills, connectors, workspaces] = await Promise.all([
      this.skillService?.findAllActive() ?? Promise.resolve([]),
      this.connectorService?.findAllActive() ?? Promise.resolve([]),
      this.workspaceService?.findAllByUser(ownerId, { page: 1, limit: 100 }) ?? Promise.resolve({
        workspaces: [],
        pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
      }),
    ]);

    return {
      availableSkills: skills.map((skill) => ({
        id: skill.id,
        skillSlug: skill.name,
        name: skill.name,
        description: skill.description || '',
        category: skill.categoryName ?? null,
      })),
      availableConnectors: connectors.map((connector) => ({
        id: connector.id,
        connectorSlug: connector.slug,
        name: connector.name,
        description: connector.description || '',
        category: connector.categoryName ?? null,
      })),
      availableConnectorActions: connectors.flatMap((connector) =>
        (connector.actions || [])
          .filter((action) => action.isEnabled !== false)
          .map((action) => ({
            connectorId: connector.id,
            connectorSlug: connector.slug,
            connectorName: connector.name,
            actionKey: action.key,
            label: action.label || action.key,
            description: action.description || '',
          })),
      ),
      availableWorkspaces: await this.buildAvailableWorkspaceCatalog(workspaces.workspaces || []),
    };
  }

  private async buildAvailableWorkspaceCatalog(workspaces: Array<{ id: string; name: string; description?: string }>) {
    if (!this.workspaceDocumentService) {
      return workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        description: workspace.description || '',
        folders: [],
      }));
    }

    return Promise.all(workspaces.map(async (workspace) => {
      const folders = await this.workspaceDocumentService!.getAllFolders(workspace.id);
      return {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description || '',
        folders: folders.slice(0, MAX_INTENT_CATALOG_FOLDERS_PER_WORKSPACE).map((folder) => ({
          id: folder.id,
          name: folder.folderName || folder.originalName,
          parentId: folder.parentId || null,
        })),
      };
    }));
  }

  private splitIntentClarifications(intent: string): { intentText: string; capturedClarifications: string } {
    const marker = '\n\nClarifications:\n';
    const normalizedIntent = intent.trim();
    const markerIndex = normalizedIntent.indexOf(marker);
    if (markerIndex === -1) {
      return { intentText: normalizedIntent, capturedClarifications: '' };
    }

    return {
      intentText: normalizedIntent.slice(0, markerIndex).trim(),
      capturedClarifications: normalizedIntent.slice(markerIndex + marker.length).trim(),
    };
  }

  private withClarificationTemplateFallback(variables: Record<string, unknown>, template: string): Record<string, unknown> {
    const capturedClarifications = this.asString(variables.captured_clarifications);
    const resolvedDesignResources = this.asString(variables.resolved_design_resources);
    const intentText = this.asString(variables.intent_text);
    const resourceBlock = resolvedDesignResources && resolvedDesignResources !== NO_RESOLVED_DESIGN_RESOURCES && !this.hasResolvedDesignResourcesPlaceholder(template)
      ? `\n\n<Resolved_Design_Resources>\n${resolvedDesignResources}\n</Resolved_Design_Resources>`
      : '';
    if (this.hasClarificationPlaceholder(template)) {
      return resourceBlock
        ? { ...variables, captured_clarifications: `${capturedClarifications}${resourceBlock}` }
        : variables;
    }

    if (!capturedClarifications || capturedClarifications === NO_CAPTURED_CLARIFICATIONS) {
      return variables;
    }

    return {
      ...variables,
      intent_text: `${intentText}\n\nClarifications:\n${capturedClarifications}${resourceBlock}`,
    };
  }

  private hasClarificationPlaceholder(template: string): boolean {
    return /\{captured_clarifications\}|\{\{\s*captured_clarifications\s*\}\}/.test(template);
  }

  private hasResolvedDesignResourcesPlaceholder(template: string): boolean {
    return /\{resolved_design_resources\}|\{\{\s*resolved_design_resources\s*\}\}/.test(template);
  }

  private extractResolvedDesignResources(capturedClarifications: string): ResolvedDesignResource[] {
    if (!capturedClarifications.trim()) {
      return [];
    }

    return capturedClarifications
      .split('\n')
      .map((line) => this.extractResolvedDesignResource(line))
      .filter((resource): resource is ResolvedDesignResource => resource !== null);
  }

  private extractResolvedDesignResource(line: string): ResolvedDesignResource | null {
    const parsed = parseDesignResourceLine(line);
    if (!parsed) {
      return null;
    }

    const metadata = this.parseResourceMetadata(parsed.metadata);
    const kind = metadata.kind;
    const id = metadata.id;
    if ((kind !== 'workspace' && kind !== 'document') || !id) {
      return null;
    }

    return {
      question: parsed.question,
      label: parsed.label,
      kind,
      id,
      ...(metadata.workspaceId ? { workspaceId: metadata.workspaceId } : {}),
      ...(metadata.workspaceName ? { workspaceName: metadata.workspaceName } : {}),
      ...(metadata.path ? { path: metadata.path } : {}),
      ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
    };
  }

  private parseResourceMetadata(metadataText: string): Record<string, string> {
    const metadata: Record<string, string> = {};
    const keyPattern = 'kind|id|workspaceId|workspaceName|path|mimeType';
    const pattern = new RegExp(`(?:^|,\\s*)(${keyPattern})=([\\s\\S]*?)(?=,\\s*(?:${keyPattern})=|$)`, 'g');
    let match = pattern.exec(metadataText);
    while (match) {
      const key = match[1]?.trim() || '';
      const value = match[2]?.trim() || '';
      if (key && value) {
        metadata[key] = value;
      }
      match = pattern.exec(metadataText);
    }
    return metadata;
  }

  normalizeConstructionSuggestions(args: {
    raw: string;
    dto: RequestPlaybookFlowIntentDto;
    selectedNodeId: string | null;
    limits: IntentNormalizationLimits;
    validationContext: IntentWorkflowValidationContext;
    includeFallback: boolean;
  }): PlaybookIntentSuggestion[] {
    return this.normalizeSuggestions(
      args.raw,
      args.dto,
      args.selectedNodeId,
      args.limits,
      args.validationContext,
      args.includeFallback,
    );
  }

  normalizeConstructionOutput(args: {
    raw: string;
    dto: RequestPlaybookFlowIntentDto;
    context: PlaybookIntentAnalysisContext;
  }): PlaybookIntentSuggestion[] {
    const useBlueprint = args.context.effectiveSettings.useDeterministicBlueprintBuilder;
    if (useBlueprint && this.blueprintParser.hasBlueprintShape(args.raw)) {
      const parsed = this.blueprintParser.parse(args.raw);
      if (parsed) {
        try {
          const buildResult = this.graphBuilder.build({
            blueprint: parsed.blueprint,
            context: args.context.validationContext,
            limits: args.context.limits,
            templates: args.context.nodeTemplates,
            designCatalog: this.buildGraphBuilderDesignCatalog(args.context.availableDesignCatalog),
            selectedNodeId: args.context.selectedNodeId,
          });
          if (buildResult.dropped.length) {
            this.logger.warn(`playbook_intent_builder_dropped items=${buildResult.dropped.map((drop) => `${drop.rule}:${drop.itemId}`).join(',')}`);
          }
          return [this.createFallbackSuggestion(args.dto, args.context.selectedNodeId), buildResult.suggestion];
        } catch (error) {
          this.logger.error(`playbook_intent_builder_failed message=${error instanceof Error ? error.message : 'unknown'}`);
        }
      }
    }

    return this.normalizeConstructionSuggestions({
      raw: args.raw,
      dto: args.dto,
      selectedNodeId: args.context.selectedNodeId,
      limits: args.context.limits,
      validationContext: args.context.validationContext,
      includeFallback: true,
    });
  }

  private buildDesignAssessmentSystemPrompt(): string {
    return `You are a strict workflow design reviewer. Before playbook generation, challenge missing requirements that would make the generated workflow unreliable.
Return JSON only. Use one of these statuses: needs_clarification, ready_for_review, ready_to_generate.
Ask concise, decision-driving questions only when missing information changes workflow structure, datasource binding, HITL approval/review, or output quality.
For every clarification question, include 2 to 4 short clickable choices that cover likely answers. Do not include an "other" choice; the UI adds that.
When a question asks the user to pick a source workspace or document, set resourceSelector to "workspace_or_document". When it asks where generated files should be saved, set resourceSelector to "destination_workspace". Omit resourceSelector otherwise.
Prefer needs_clarification when datasource, trigger, required inputs, final output, business rules, approval/review, or external side effects are unclear.
Use ready_for_review when enough information exists but assumptions should be confirmed.
Use ready_to_generate only when the intent is complete and low risk.
Shape:
{"status":"needs_clarification","detectedIntent":"...","questions":[{"id":"q1","question":"...","reason":"...","category":"datasource|trigger|input|output|business_rule|approval|scope","required":true,"choices":["..."],"resourceSelector":"workspace_or_document|destination_workspace"}],"missingRequirements":["..."],"riskFlags":["..."]}
or {"status":"ready_for_review","detectedIntent":"...","brief":{"goal":"...","trigger":"...","datasources":["..."],"steps":["..."],"outputs":["..."],"hitlRules":["..."]},"assumptions":["..."],"riskFlags":["..."]}
or {"status":"ready_to_generate","detectedIntent":"...","assumptions":["..."],"riskFlags":["..."]}`;
  }

  private normalizeDesignAssessment(raw: string, intent: string): PlaybookIntentDesignResponse {
    const parsed = this.parseJsonObject(raw);
    if (!parsed) return this.buildFallbackDesignAssessment(intent);
    const status = parsed.status;
    if (status === 'ready_to_generate') return this.normalizeReadyToGenerate(parsed, intent);
    if (status === 'ready_for_review') return this.normalizeReadyForReview(parsed, intent);
    return this.normalizeNeedsClarification(parsed, intent);
  }

  private normalizeNeedsClarification(parsed: Record<string, unknown>, intent: string): PlaybookIntentDesignResponse {
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const normalizedQuestions = questions
      .map((question, index) => this.normalizeClarificationQuestion(question, index))
      .filter((question) => question.question);
    return {
      status: 'needs_clarification',
      detectedIntent: this.asString(parsed.detectedIntent) || intent.trim(),
      questions: normalizedQuestions.length > 0 ? normalizedQuestions : this.buildFallbackQuestions(),
      missingRequirements: this.asStringArray(parsed.missingRequirements),
      riskFlags: this.asStringArray(parsed.riskFlags),
    };
  }

  private normalizeReadyForReview(parsed: Record<string, unknown>, intent: string): PlaybookIntentDesignResponse {
    const brief = typeof parsed.brief === 'object' && parsed.brief ? parsed.brief as Record<string, unknown> : {};
    return {
      status: 'ready_for_review',
      detectedIntent: this.asString(parsed.detectedIntent) || intent.trim(),
      brief: {
        goal: this.asString(brief.goal) || intent.trim(),
        trigger: this.asString(brief.trigger) || 'Manual trigger',
        datasources: this.asStringArray(brief.datasources),
        steps: this.asStringArray(brief.steps),
        outputs: this.asStringArray(brief.outputs),
        hitlRules: this.asStringArray(brief.hitlRules),
      },
      assumptions: this.asStringArray(parsed.assumptions),
      riskFlags: this.asStringArray(parsed.riskFlags),
    };
  }

  private normalizeReadyToGenerate(parsed: Record<string, unknown>, intent: string): PlaybookIntentDesignResponse {
    return {
      status: 'ready_to_generate',
      detectedIntent: this.asString(parsed.detectedIntent) || intent.trim(),
      assumptions: this.asStringArray(parsed.assumptions),
      riskFlags: this.asStringArray(parsed.riskFlags),
    };
  }

  private normalizeClarificationQuestion(value: unknown, index: number): PlaybookIntentClarificationQuestion {
    const item = typeof value === 'object' && value ? value as Record<string, unknown> : {};
    const allowedCategories = ['datasource', 'trigger', 'input', 'output', 'business_rule', 'approval', 'scope'];
    const category = this.asString(item.category);
    return {
      id: this.asString(item.id) || `q${index + 1}`,
      question: this.asString(item.question),
      reason: this.asString(item.reason),
      category: this.asQuestionCategory(category, allowedCategories),
      required: item.required !== false,
      choices: [...new Set(this.asStringArray(item.choices))].slice(0, 4),
      ...this.buildQuestionResourceSelector(item.resourceSelector),
    };
  }

  private buildQuestionResourceSelector(value: unknown): Pick<PlaybookIntentClarificationQuestion, 'resourceSelector'> {
    const resourceSelector = this.asString(value);
    return resourceSelector === 'workspace_or_document' || resourceSelector === 'destination_workspace'
      ? { resourceSelector }
      : {};
  }

  private asQuestionCategory(category: string, allowedCategories: string[]): PlaybookIntentClarificationQuestion['category'] {
    return allowedCategories.includes(category)
      ? category as PlaybookIntentClarificationQuestion['category']
      : 'scope';
  }

  private parseJsonObject(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => this.asString(item)).filter(Boolean).slice(0, 8) : [];
  }

  private buildFallbackDesignAssessment(intent: string): PlaybookIntentDesignResponse {
    return { status: 'needs_clarification', detectedIntent: intent.trim(), questions: this.buildFallbackQuestions(), missingRequirements: ['Workflow requirements need confirmation.'], riskFlags: [] };
  }

  private buildFallbackQuestions() {
    return [
      { id: 'datasource', question: 'Which datasource should this workflow use?', reason: 'Datasource choice affects workflow structure and input bindings.', category: 'datasource' as const, required: true, choices: ['Workspace documents', 'Connected business app', 'Uploaded files'], resourceSelector: 'workspace_or_document' as const },
      { id: 'output', question: 'What final output should the workflow produce?', reason: 'The output contract determines the final steps.', category: 'output' as const, required: true, choices: ['Summary report', 'Structured table', 'Approval-ready recommendation'] },
    ];
  }

  private buildValidationContext(flow: any): IntentWorkflowValidationContext {
    const nodes: Array<{ id: string; label?: string; metadata?: { agentSlug?: string }; input?: { ports?: Array<{ id: string; type?: string }> }; output?: { ports?: Array<{ id: string; type?: string }> } }> = flow.nodes || [];
    const bindings: Array<{ targetNode: string; targetPort: string }> = flow.dataBindings || [];

    const existingTaskIds = new Set<string>();
    const existingTaskTitles = new Map<string, string>();
    const existingTaskAgents = new Map<string, string | null>();
    const inputPortsByTaskId = new Map<string, Map<string, string>>();
    const outputPortsByTaskId = new Map<string, Map<string, string>>();
    const existingBindingTargets = new Set<string>();

    for (const node of nodes) {
      existingTaskIds.add(node.id);
      existingTaskTitles.set(node.id, (node.label || '').trim().toLowerCase().replace(/\s+/g, ' '));
      existingTaskAgents.set(node.id, node.metadata?.agentSlug || null);

      const inputMap = new Map<string, string>();
      for (const p of node.input?.ports || []) {
        if (p.id && p.type) inputMap.set(p.id, p.type);
      }
      inputPortsByTaskId.set(node.id, inputMap);

      const outputMap = new Map<string, string>();
      for (const p of node.output?.ports || []) {
        if (p.id && p.type) outputMap.set(p.id, p.type);
      }
      outputPortsByTaskId.set(node.id, outputMap);
    }

    for (const b of bindings) {
      existingBindingTargets.add(`${b.targetNode}:${b.targetPort}`);
    }

    return { existingTaskIds, existingTaskTitles, existingTaskAgents, inputPortsByTaskId, outputPortsByTaskId, existingBindingTargets };
  }

  private buildWorkflowSummary(flow: any, selectedNodeId: string | null) {
    const nodes: Array<{ id: string; label?: string; description?: string; metadata?: Record<string, unknown>; input?: { ports?: Array<{ id: string; label?: string; type?: string; required?: boolean }> }; output?: { ports?: Array<{ id: string; label?: string; type?: string }> } }> = flow.nodes || [];
    const edges: Array<{ source: string; target: string; sourceOutputPortId?: string; targetInputPortId?: string }> = flow.controlEdges || [];
    const bindings: Array<{ id: string; sourceKind: string; targetNode: string; targetPort: string; sourceNode?: string; sourcePort?: string; iteration?: string }> = flow.dataBindings || [];

    return {
      taskCount: nodes.length,
      edgeCount: edges.length,
      dataBindingCount: bindings.length,
      tasks: nodes.map((node) => ({
        id: node.id,
        title: node.label || node.id,
        description: node.description || (node.metadata?.description as string) || '',
        inputPorts: (node.input?.ports || []).map((p) => ({ id: p.id, name: p.label || p.id, artifactKind: p.type, required: p.required === true })),
        outputPorts: (node.output?.ports || []).map((p) => ({ id: p.id, name: p.label || p.id, artifactKind: p.type })),
      })),
      edges: edges.map((edge) => ({
        sourceId: edge.source,
        targetId: edge.target,
        sourceOutputPortId: edge.sourceOutputPortId || null,
        targetInputPortId: edge.targetInputPortId || null,
      })),
      dataBindings: bindings.map((b) => ({
        id: b.id,
        sourceKind: b.sourceKind,
        targetNode: b.targetNode,
        targetPort: b.targetPort,
        sourceNode: b.sourceNode || null,
        sourcePort: b.sourcePort || null,
        iteration: b.iteration || null,
      })),
    };
  }

  private buildSelectedNodeContext(flow: any, selectedNodeId: string | null) {
    if (!selectedNodeId) {
      return { upstream: [], downstream: [], incomingBindings: [], outgoingBindings: [] };
    }

    const edges: Array<{ source: string; target: string }> = flow.controlEdges || [];
    const nodes: Array<{ id: string; label?: string; description?: string; metadata?: Record<string, unknown>; input?: { ports?: Array<{ id: string; label?: string; type?: string; required?: boolean }> }; output?: { ports?: Array<{ id: string; label?: string; type?: string }> } }> = flow.nodes || [];
    const bindings: Array<{ id: string; sourceKind: string; targetNode: string; targetPort: string; sourceNode?: string; sourcePort?: string }> = flow.dataBindings || [];

    const upstreamIds = edges.filter((e) => e.target === selectedNodeId).map((e) => e.source);
    const downstreamIds = edges.filter((e) => e.source === selectedNodeId).map((e) => e.target);

    return {
      upstream: nodes.filter((n) => upstreamIds.includes(n.id)).map((n) => ({ id: n.id, title: n.label || n.id, description: n.description || (n.metadata?.description as string) || '', outputPorts: (n.output?.ports || []).map((p) => ({ id: p.id, name: p.label || p.id, artifactKind: p.type })) })),
      downstream: nodes.filter((n) => downstreamIds.includes(n.id)).map((n) => ({ id: n.id, title: n.label || n.id, description: n.description || (n.metadata?.description as string) || '', inputPorts: (n.input?.ports || []).map((p) => ({ id: p.id, name: p.label || p.id, artifactKind: p.type, required: p.required === true })) })),
      incomingBindings: bindings.filter((b) => b.targetNode === selectedNodeId).map((b) => ({ id: b.id, sourceKind: b.sourceKind, sourceNode: b.sourceNode || null, sourcePort: b.sourcePort || null, targetPort: b.targetPort })),
      outgoingBindings: bindings.filter((b) => b.sourceNode === selectedNodeId).map((b) => ({ id: b.id, sourceKind: b.sourceKind, targetNode: b.targetNode, targetPort: b.targetPort, sourcePort: b.sourcePort || null })),
    };
  }

  extractChatCompletionText(responseData: unknown): string {
    const content = (responseData as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof (item as { text?: unknown })?.text === 'string' ? String((item as { text?: unknown }).text) : ''))
        .join('\n')
        .trim();
    }
    return '';
  }

  private normalizeSuggestions(
    raw: string,
    dto: RequestPlaybookFlowIntentDto,
    selectedNodeId: string | null,
    limits: IntentNormalizationLimits,
    validationContext: IntentWorkflowValidationContext,
    includeFallback = true,
  ): PlaybookIntentSuggestion[] {
    try {
      const parsed = JSON.parse(raw || '{}') as { suggestions?: Array<Record<string, unknown>> };
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      const normalized = suggestions
        .slice(0, 6)
        .map((item, index) => this.normalizeSuggestion(item, index, selectedNodeId, limits, validationContext))
        .filter((item): item is PlaybookIntentSuggestion => item !== null);

      return includeFallback ? [this.createFallbackSuggestion(dto, selectedNodeId), ...normalized] : normalized;
    } catch {
      return includeFallback ? [this.createFallbackSuggestion(dto, selectedNodeId)] : [];
    }
  }

  private normalizeSuggestion(
    item: Record<string, unknown>,
    index: number,
    selectedNodeId: string | null,
    limits: IntentNormalizationLimits,
    validationContext: IntentWorkflowValidationContext,
  ): PlaybookIntentSuggestion | null {
    if (item.kind === 'workflow_plan' || Array.isArray(item.changes) || this.looksLikeWorkflowPlanImpact(item.impact)) {
      return this.normalizeWorkflowPlanSuggestion(item, index, limits, validationContext);
    }

    const label = this.normalizeText(item.label) || this.normalizeText(item.title);
    const nestedTask = item.task && typeof item.task === 'object' ? item.task as Record<string, unknown> : null;
    const operationType = this.normalizeOperationType(item.operationType, selectedNodeId);
    const derivedLabel = label
      || (nestedTask ? this.normalizeText(nestedTask.title) || this.normalizeText(nestedTask.description)?.slice(0, 100) : '')
      || this.normalizeText(item.summary)?.slice(0, 100);
    if (!derivedLabel) {
      return null;
    }

    const explicitTitle = this.normalizeText(item.taskTitle) || this.normalizeText(nestedTask?.title);
    const taskTitle = operationType === 'update_node' ? explicitTitle : (explicitTitle || derivedLabel);
    const taskDescription = this.normalizeText(item.taskDescription) || this.normalizeText(nestedTask?.description) || this.normalizeText(item.summary);
    const agentSlug = this.normalizeText(item.agentSlug) || this.normalizeText(nestedTask?.agentSlug);
    const templateType = this.normalizeText(item.templateType) || this.normalizeText(nestedTask?.templateType);
    const inputPorts = nestedTask ? this.normalizeInputPorts(nestedTask.inputPorts, limits) : [];
    const outputPorts = nestedTask ? this.normalizeOutputPorts(nestedTask.outputPorts, limits) : [];

    const task = operationType === 'delete_node'
      ? null
      : operationType === 'update_node'
        ? {
          ...(taskTitle ? { title: taskTitle } : {}),
          description: taskDescription,
          ...(agentSlug ? { agentSlug } : {}),
          ...(templateType ? { templateType } : {}),
          ...(inputPorts.length ? { inputPorts } : {}),
          ...(outputPorts.length ? { outputPorts } : {}),
        }
        : {
          title: taskTitle || label,
          description: taskDescription,
          agentSlug: agentSlug || null,
          templateType: templateType || null,
          ...(inputPorts.length ? { inputPorts } : {}),
          ...(outputPorts.length ? { outputPorts } : {}),
        };

    return {
      id: `intent-${index}`,
      kind: 'single_change',
      label: derivedLabel,
      summary: this.normalizeText(item.summary) || '',
      reason: this.normalizeText(item.reason) || '',
      confidence: this.normalizeConfidence(item.confidence),
      operationType,
      task,
      targetTaskId: this.normalizeText(item.targetTaskId) || this.normalizeText(item.nodeRef) || selectedNodeId,
      isDirectIntentFallback: false,
    };
  }

  private normalizeWorkflowPlanSuggestion(
    item: Record<string, unknown>,
    index: number,
    limits: IntentNormalizationLimits,
    ctx: IntentWorkflowValidationContext,
  ): PlaybookIntentWorkflowPlanSuggestion | null {
    const label = this.normalizeText(item.label) || this.normalizeText(item.title);
    if (!label || !Array.isArray(item.changes)) {
      return null;
    }

    const rawChanges = item.changes
      .slice(0, limits.maxWorkflowPlanChanges)
      .map((change) => this.normalizeWorkflowChange(change, limits))
      .filter((change): change is PlaybookIntentWorkflowChange => change !== null);

    const createdNodeRefs = new Set<string>();
    const deletedTaskIds = new Set<string>();
    const acceptedChanges: PlaybookIntentWorkflowChange[] = [];

    for (const change of rawChanges) {
      const validated = this.validateWorkflowChange(change, ctx, createdNodeRefs, deletedTaskIds);
      if (validated) {
        acceptedChanges.push(validated);
        if (validated.type === 'create_node') {
          createdNodeRefs.add(validated.nodeRef);
        }
        if (validated.type === 'delete_node') {
          deletedTaskIds.add(validated.targetTaskId);
        }
      }
    }

    const resolvedChanges = this.graphBindingResolver.resolveWorkflowChanges({
      changes: acceptedChanges,
      context: ctx,
      deletedTaskIds,
    });

    if (resolvedChanges.length === 0) {
      return null;
    }

    return {
      id: `intent-${index}`,
      kind: 'workflow_plan',
      label,
      summary: this.normalizeText(item.summary) || '',
      reason: this.normalizeText(item.reason) || '',
      confidence: this.normalizeConfidence(item.confidence),
      impact: this.normalizeWorkflowImpact(item.impact, resolvedChanges),
      changes: resolvedChanges,
      isDirectIntentFallback: false,
    };
  }

  private normalizeComparableTitle(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private validateWorkflowChange(
    change: PlaybookIntentWorkflowChange,
    ctx: IntentWorkflowValidationContext,
    createdNodeRefs: Set<string>,
    deletedTaskIds: Set<string>,
  ): PlaybookIntentWorkflowChange | null {
    if (change.type === 'create_node') {
      if (createdNodeRefs.has(change.nodeRef)) {
        return null;
      }

      const newTitle = this.normalizeComparableTitle(change.task.title);
      const newAgent = change.task.agentSlug || null;
      for (const [taskId, existingTitle] of ctx.existingTaskTitles) {
        if (existingTitle === newTitle) {
          const existingAgent = ctx.existingTaskAgents.get(taskId);
          if (existingAgent === newAgent) {
            return null;
          }
        }
      }

      return change;
    }

    if (change.type === 'update_node') {
      if (!ctx.existingTaskIds.has(change.targetTaskId)) {
        return null;
      }
      return change;
    }

    if (change.type === 'delete_node') {
      if (!ctx.existingTaskIds.has(change.targetTaskId)) {
        return null;
      }
      return change;
    }

    if (change.type === 'create_edge' || change.type === 'delete_edge') {
      const sourceValid = this.resolveTaskRef(change.sourceTaskId, change.sourceNodeRef, ctx.existingTaskIds, createdNodeRefs);
      const targetValid = this.resolveTaskRef(change.targetTaskId, change.targetNodeRef, ctx.existingTaskIds, createdNodeRefs);
      if (!sourceValid || !targetValid) {
        return null;
      }

      if (change.type === 'create_edge') {
        if (change.sourceTaskId && deletedTaskIds.has(change.sourceTaskId)) {
          return null;
        }
        if (change.targetTaskId && deletedTaskIds.has(change.targetTaskId)) {
          return null;
        }
      }

      return change;
    }

    if (change.type === 'create_data_binding') {
      const targetValid = this.resolveTaskRef(change.targetTaskId, change.targetNodeRef, ctx.existingTaskIds, createdNodeRefs);
      if (!targetValid) {
        return null;
      }

      if (change.sourceKind === 'constant') {
        if (change.targetTaskId && ctx.existingTaskIds.has(change.targetTaskId)) {
          const inputPorts = ctx.inputPortsByTaskId.get(change.targetTaskId);
          if (inputPorts && change.targetPort && !inputPorts.has(change.targetPort)) {
            return null;
          }
        }
        return change;
      }

      const sourceValid = this.resolveTaskRef(change.sourceTaskId, change.sourceNodeRef, ctx.existingTaskIds, createdNodeRefs);
      if (!sourceValid) {
        return null;
      }

      if (change.sourceTaskId && ctx.existingTaskIds.has(change.sourceTaskId)) {
        const outputPorts = ctx.outputPortsByTaskId.get(change.sourceTaskId);
        if (outputPorts && change.sourcePort && !outputPorts.has(change.sourcePort)) {
          return null;
        }
      }

      if (change.targetTaskId && ctx.existingTaskIds.has(change.targetTaskId)) {
        const inputPorts = ctx.inputPortsByTaskId.get(change.targetTaskId);
        if (inputPorts && change.targetPort && !inputPorts.has(change.targetPort)) {
          return null;
        }
      }

      if (
        change.sourceTaskId && ctx.existingTaskIds.has(change.sourceTaskId)
        && change.targetTaskId && ctx.existingTaskIds.has(change.targetTaskId)
        && change.sourcePort && change.targetPort
      ) {
        const sourceKind = ctx.outputPortsByTaskId.get(change.sourceTaskId)?.get(change.sourcePort);
        const targetKind = ctx.inputPortsByTaskId.get(change.targetTaskId)?.get(change.targetPort);
        if (sourceKind && targetKind && sourceKind !== targetKind) {
          return null;
        }
      }

      return change;
    }

    if (change.type === 'delete_data_binding') {
      if (change.targetTaskId && !ctx.existingTaskIds.has(change.targetTaskId)) {
        return null;
      }
      if (change.targetTaskId && ctx.existingTaskIds.has(change.targetTaskId)) {
        const inputPorts = ctx.inputPortsByTaskId.get(change.targetTaskId);
        if (inputPorts && !inputPorts.has(change.targetPort)) {
          return null;
        }
      }
      return change;
    }

    return null;
  }

  private resolveTaskRef(
    taskId: string | null,
    nodeRef: string | null,
    existingTaskIds: Set<string>,
    createdNodeRefs: Set<string>,
  ): boolean {
    if (taskId) return existingTaskIds.has(taskId);
    if (nodeRef) return createdNodeRefs.has(nodeRef);
    return false;
  }

  private normalizeWorkflowChange(value: unknown, limits: IntentNormalizationLimits): PlaybookIntentWorkflowChange | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const item = value as Record<string, unknown>;
    if (item.type === 'create_node') {
      const nodeRef = this.normalizeText(item.nodeRef);
      const task = this.normalizeTaskDraft(
        item.task,
        this.normalizeText(item.taskTitle),
        this.normalizeText(item.taskDescription),
        limits,
      );
      if (!nodeRef || !task) {
        return null;
      }

      return {
        type: 'create_node',
        nodeRef,
        anchor: this.normalizeWorkflowAnchor(item.anchor),
        task,
      };
    }

    if (item.type === 'update_node') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const task = this.normalizePartialTaskDraft(
        item.task,
        this.normalizeText(item.taskTitle),
        this.normalizeText(item.taskDescription),
        limits,
      );
      if (!targetTaskId || Object.keys(task).length === 0) {
        return null;
      }
      return { type: 'update_node', targetTaskId, task };
    }

    if (item.type === 'delete_node') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      return targetTaskId ? { type: 'delete_node', targetTaskId } : null;
    }

    if (item.type === 'create_edge' || item.type === 'delete_edge') {
      const sourceTaskId = this.normalizeText(item.sourceTaskId);
      const sourceNodeRef = this.normalizeText(item.sourceNodeRef) || this.normalizeText(item.sourceRef) || this.normalizeText(item.fromNodeRef);
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const targetNodeRef = this.normalizeText(item.targetNodeRef) || this.normalizeText(item.targetRef) || this.normalizeText(item.toNodeRef);

      if (!(sourceTaskId || sourceNodeRef) || !(targetTaskId || targetNodeRef)) {
        return null;
      }

      return {
        type: item.type,
        sourceTaskId: sourceTaskId || null,
        sourceNodeRef: sourceNodeRef || null,
        targetTaskId: targetTaskId || null,
        targetNodeRef: targetNodeRef || null,
        ...(this.normalizeText(item.sourceOutputPortId) ? { sourceOutputPortId: this.normalizeText(item.sourceOutputPortId) } : {}),
        ...(this.normalizeText(item.targetInputPortId) ? { targetInputPortId: this.normalizeText(item.targetInputPortId) } : {}),
      };
    }

    if (item.type === 'create_data_binding') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const targetNodeRef = this.normalizeText(item.targetNodeRef);
      const targetPort = this.normalizeText(item.targetPort);
      if (!targetPort || !(targetTaskId || targetNodeRef)) {
        return null;
      }
      const sourceTaskId = this.normalizeText(item.sourceTaskId);
      const sourceNodeRef = this.normalizeText(item.sourceNodeRef);
      const sourcePort = this.normalizeText(item.sourcePort);
      if (item.sourceKind === 'constant') {
        const constantValue = this.normalizeResolvedDesignResourceBindingValue(item.constantValue);
        return constantValue ? {
          type: 'create_data_binding',
          targetTaskId: targetTaskId || null,
          targetNodeRef: targetNodeRef || null,
          targetPort,
          sourceKind: 'constant',
          constantValue,
        } : null;
      }

      if (item.sourceKind !== 'node-output' || !(sourceTaskId || sourceNodeRef) || !sourcePort) {
        return null;
      }
      return {
        type: 'create_data_binding',
        targetTaskId: targetTaskId || null,
        targetNodeRef: targetNodeRef || null,
        targetPort,
        sourceKind: 'node-output',
        sourceTaskId: sourceTaskId || null,
        sourceNodeRef: sourceNodeRef || null,
        sourcePort: sourcePort || null,
        iteration: item.iteration === 'previous' ? 'previous' : 'current',
      };
    }

    if (item.type === 'delete_data_binding') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const targetNodeRef = this.normalizeText(item.targetNodeRef);
      const targetPort = this.normalizeText(item.targetPort);
      if (!targetPort || !(targetTaskId || targetNodeRef)) {
        return null;
      }
      const sourceTaskId = this.normalizeText(item.sourceTaskId);
      const sourceNodeRef = this.normalizeText(item.sourceNodeRef);
      const sourcePort = this.normalizeText(item.sourcePort);
      return {
        type: 'delete_data_binding',
        targetTaskId: targetTaskId || null,
        targetNodeRef: targetNodeRef || null,
        targetPort,
        ...(sourceTaskId ? { sourceTaskId: sourceTaskId || null } : {}),
        ...(sourceNodeRef ? { sourceNodeRef: sourceNodeRef || null } : {}),
        ...(sourcePort ? { sourcePort: sourcePort || null } : {}),
      };
    }

    return null;
  }

  private normalizeResolvedDesignResourceBindingValue(value: unknown): ResolvedDesignResourceBindingValue | null {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const kind = this.normalizeText(item.kind);
    const id = this.normalizeText(item.id);
    const workspaceId = this.normalizeText(item.workspaceId) || (kind === 'workspace' ? id : '');
    if ((kind !== 'document' && kind !== 'workspace') || !id || !workspaceId) {
      return null;
    }

    return {
      kind,
      id,
      workspaceId,
      ...(kind === 'document' ? { documentId: this.normalizeText(item.documentId) || id } : {}),
      ...(this.normalizeText(item.question) ? { question: this.normalizeText(item.question) } : { question: '' }),
      ...(this.normalizeText(item.label) ? { label: this.normalizeText(item.label) } : { label: '' }),
      ...(this.normalizeText(item.workspaceName) ? { workspaceName: this.normalizeText(item.workspaceName) } : {}),
      ...(this.normalizeText(item.path) ? { path: this.normalizeText(item.path) } : {}),
      ...(this.normalizeText(item.mimeType) ? { mimeType: this.normalizeText(item.mimeType) } : {}),
    };
  }

  private normalizeWorkflowAnchor(value: unknown): { mode: 'append' | 'before' | 'after' | 'as_input'; targetTaskId: string | null; nodeRef: string | null; targetTaskIds?: string[]; nodeRefs?: string[]; sourceOutputPortId?: string | null; targetInputPortId?: string | null } {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const mode = item.mode === 'before' || item.mode === 'after' || item.mode === 'append' || item.mode === 'as_input' ? item.mode : 'append';
    return {
      mode,
      targetTaskId: this.normalizeText(item.targetTaskId) || null,
      nodeRef: this.normalizeText(item.nodeRef) || null,
      targetTaskIds: this.normalizeTextArray(item.targetTaskIds),
      nodeRefs: this.normalizeTextArray(item.nodeRefs),
      sourceOutputPortId: this.normalizeText(item.sourceOutputPortId) || null,
      targetInputPortId: this.normalizeText(item.targetInputPortId) || null,
    };
  }

  private normalizeTaskDraft(
    value: unknown,
    fallbackTitle = '',
    fallbackDescription = '',
    limits: IntentNormalizationLimits,
  ): PlaybookIntentTaskDraft | null {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const title = this.normalizeText(item.title) || fallbackTitle;
    const description = this.normalizeText(item.description) || fallbackDescription;
    const agentSlug = this.normalizeText(item.agentSlug);
    const templateType = this.normalizeText(item.templateType);
    const inputPorts = this.normalizeInputPorts(item.inputPorts, limits);
    const outputPorts = this.normalizeOutputPorts(item.outputPorts, limits);
    const iteratorBody = this.normalizeIteratorBody(item.iteratorBody, limits);
    return title
      ? {
        title,
        description,
        ...(agentSlug ? { agentSlug } : {}),
        ...(templateType ? { templateType } : {}),
        ...(inputPorts.length ? { inputPorts } : {}),
        ...(outputPorts.length ? { outputPorts } : {}),
        ...(iteratorBody ? { iteratorBody } : {}),
      }
      : null;
  }

  private normalizePartialTaskDraft(
    value: unknown,
    fallbackTitle = '',
    fallbackDescription = '',
    limits: IntentNormalizationLimits,
  ): Partial<PlaybookIntentTaskDraft> {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const title = this.normalizeText(item.title) || fallbackTitle;
    const description = this.normalizeText(item.description) || fallbackDescription;
    const agentSlug = this.normalizeText(item.agentSlug);
    const templateType = this.normalizeText(item.templateType);
    const inputPorts = this.normalizeInputPorts(item.inputPorts, limits);
    const outputPorts = this.normalizeOutputPorts(item.outputPorts, limits);
    const iteratorBody = this.normalizeIteratorBody(item.iteratorBody, limits);
    return {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(agentSlug ? { agentSlug } : {}),
      ...(templateType ? { templateType } : {}),
      ...(inputPorts.length ? { inputPorts } : {}),
      ...(outputPorts.length ? { outputPorts } : {}),
      ...(iteratorBody ? { iteratorBody } : {}),
    };
  }

  private normalizeIteratorBody(value: unknown, limits: IntentNormalizationLimits): PlaybookIntentTaskDraft['iteratorBody'] | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const steps = Array.isArray(item.steps)
      ? item.steps
        .map((step) => {
          if (!step || typeof step !== 'object') {
            return null;
          }

          const draft = step as Record<string, unknown>;
          const nodeRef = this.normalizeText(draft.nodeRef);
          const title = this.normalizeText(draft.title);
          if (!nodeRef || !title) {
            return null;
          }

          const description = this.normalizeText(draft.description);
          const agentSlug = this.normalizeText(draft.agentSlug);
          const templateType = this.normalizeText(draft.templateType);
          const inputPorts = this.normalizeInputPorts(draft.inputPorts, limits);
          const outputPorts = this.normalizeOutputPorts(draft.outputPorts, limits);
          return {
            nodeRef,
            title,
            description,
            ...(agentSlug ? { agentSlug } : {}),
            ...(templateType ? { templateType } : {}),
            ...(inputPorts.length ? { inputPorts } : {}),
            ...(outputPorts.length ? { outputPorts } : {}),
          };
        })
        .filter((step): step is NonNullable<typeof step> => step !== null)
        .slice(0, limits.maxIteratorBodySteps)
      : [];

    const validStepRefs = new Set(steps.map((s) => s.nodeRef));

    const edges = Array.isArray(item.edges)
      ? item.edges
        .map((edge) => {
          if (!edge || typeof edge !== 'object') {
            return null;
          }

          const normalizedEdge = edge as Record<string, unknown>;
          const sourceNodeRef = this.normalizeText(normalizedEdge.sourceNodeRef);
          const targetNodeRef = this.normalizeText(normalizedEdge.targetNodeRef);
          const sourceOutputPortId = this.normalizeText(normalizedEdge.sourceOutputPortId);
          const targetInputPortId = this.normalizeText(normalizedEdge.targetInputPortId);
          if (!sourceNodeRef || !targetNodeRef) {
            return null;
          }
          if (!validStepRefs.has(sourceNodeRef) || !validStepRefs.has(targetNodeRef)) {
            return null;
          }
          return {
            sourceNodeRef,
            targetNodeRef,
            ...(sourceOutputPortId ? { sourceOutputPortId } : {}),
            ...(targetInputPortId ? { targetInputPortId } : {}),
          };
        })
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null)
        .slice(0, limits.maxIteratorBodyEdges)
      : [];

    return steps.length > 0 ? { steps, edges } : undefined;
  }

  private normalizeWorkflowImpact(value: unknown, changes: PlaybookIntentWorkflowChange[]): PlaybookIntentWorkflowPlanSuggestion['impact'] {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const affectedTaskIds = Array.isArray(item.affectedTaskIds)
      ? item.affectedTaskIds.map((id: unknown) => this.normalizeText(id)).filter(Boolean).slice(0, 20)
      : changes.flatMap((change) => [
        ...('targetTaskId' in change && change.targetTaskId ? [change.targetTaskId] : []),
        ...('sourceTaskId' in change && change.sourceTaskId ? [change.sourceTaskId] : []),
      ]);

    return {
      nodesToCreate: changes.filter((change) => change.type === 'create_node').length,
      nodesToUpdate: changes.filter((change) => change.type === 'update_node').length,
      nodesToDelete: changes.filter((change) => change.type === 'delete_node').length,
      edgesToCreate: changes.filter((change) => change.type === 'create_edge').length,
      edgesToDelete: changes.filter((change) => change.type === 'delete_edge').length,
      dataBindingsToCreate: changes.filter((change) => change.type === 'create_data_binding').length,
      dataBindingsToDelete: changes.filter((change) => change.type === 'delete_data_binding').length,
      affectedTaskIds: [...new Set(affectedTaskIds)],
      businessOutcome: this.normalizeText(item.businessOutcome),
    };
  }

  private looksLikeWorkflowPlanImpact(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const item = value as Record<string, unknown>;
    return [
      item.nodesToCreate,
      item.nodesToUpdate,
      item.nodesToDelete,
      item.edgesToCreate,
      item.edgesToDelete,
    ].some((count) => typeof count === 'number');
  }

  private createFallbackSuggestion(dto: RequestPlaybookFlowIntentDto, selectedNodeId: string | null): PlaybookIntentSuggestion {
    const normalizedIntent = dto.intent.trim();

    return {
      id: 'intent-fallback',
      kind: 'single_change',
      label: '',
      summary: normalizedIntent,
      reason: '',
      confidence: 1,
      operationType: selectedNodeId ? 'update_node' : 'create_node',
      task: {
        title: normalizedIntent.slice(0, 120),
        description: normalizedIntent,
      },
      targetTaskId: selectedNodeId,
      isDirectIntentFallback: true,
    };
  }

  private normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeConfidence(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0.65;
    }
    return Math.max(0, Math.min(1, value));
  }

  private normalizeTextArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((item) => this.normalizeText(item)).filter(Boolean).slice(0, 12)
      : [];
  }

  private normalizeArtifactKind(value: unknown): 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard' | '' {
    return value === 'text'
      || value === 'document'
      || value === 'code'
      || value === 'image'
      || value === 'data'
      || value === 'dashboard'
      ? value
      : '';
  }

  private normalizeInputPorts(value: unknown, limits: IntentNormalizationLimits): NonNullable<PlaybookIntentTaskDraft['inputPorts']> {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen = new Set<string>();
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const port = item as Record<string, unknown>;
        const id = this.normalizeText(port.id);
        const artifactKind = this.normalizeArtifactKind(port.artifactKind);
        if (!id || !artifactKind || seen.has(id)) {
          return null;
        }

        seen.add(id);
        const name = this.normalizeText(port.name);
        return {
          id,
          artifactKind,
          required: port.required === true,
          ...(name ? { name } : {}),
        };
      })
      .filter((port): port is NonNullable<typeof port> => port !== null)
      .slice(0, limits.maxInputPorts);
  }

  private normalizeOutputPorts(value: unknown, limits: IntentNormalizationLimits): NonNullable<PlaybookIntentTaskDraft['outputPorts']> {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen = new Set<string>();
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const port = item as Record<string, unknown>;
        const id = this.normalizeText(port.id);
        const artifactKind = this.normalizeArtifactKind(port.artifactKind);
        if (!id || !artifactKind || seen.has(id)) {
          return null;
        }

        seen.add(id);
        const name = this.normalizeText(port.name);
        return {
          id,
          artifactKind,
          ...(name ? { name } : {}),
        };
      })
      .filter((port): port is NonNullable<typeof port> => port !== null)
      .slice(0, limits.maxOutputPorts);
  }

  private normalizeOperationType(value: unknown, selectedNodeId: string | null): PlaybookIntentOperationType {
    return value === 'create_node'
      || value === 'insert_before'
      || value === 'insert_after'
      || value === 'update_node'
      || value === 'delete_node'
      || value === 'update_hitl_policy'
      || value === 'create_blocker_rule'
      || value === 'update_blocker_rule'
      || value === 'delete_blocker_rule'
      || value === 'create_hitl_memory'
      ? value
      : selectedNodeId
        ? 'insert_after'
        : 'create_node';
  }
}

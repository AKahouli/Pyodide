import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { AgentService } from '@modules/agent/agent.service';
import {
  FlowExecution,
  FlowExecutionDocument,
} from '../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';
import { FlowRouterDecision, FlowRouterDecisionDocument } from '../schemas/playbook-flow-router-decision.schema';
import { PlaybookFlowQueueService } from './playbook-flow-queue.service';
import { PlaybookFlowIdempotencyService } from './playbook-flow-idempotency.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { PlaybookFlowBuilderService } from './playbook-flow-builder.service';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';
import { RESERVED_LABELS } from '../constants/reserved-labels';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '../../exceptions/exceptions/http.exceptions';
import {
  IFlowExecutionResponse,
  IFlowExecutionDetailResponse,
  IFlowExecutionListResponse,
  IFlowTaskResultResponse,
  IFlowRouterDecisionResponse,
  IResumeApprovalPayload,
} from '../interfaces/playbook-flow-execution.interface';
import { ControlEdge, DataBinding, FlowNode } from '../schemas/playbook-flow.schema';

export function toGrpcValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    // Match the working chatbot/playbook gRPC path: proto-loader expects camelCase
    // Value selectors here, otherwise Struct map entries arrive as empty/null values.
    return { nullValue: 'NULL_VALUE', kind: 'nullValue' };
  }
  if (Array.isArray(value)) {
    return {
      listValue: { values: value.map((item) => toGrpcValue(item)) },
      kind: 'listValue',
    };
  }
  switch (typeof value) {
    case 'string':
      return { stringValue: value, kind: 'stringValue' };
    case 'number':
      return { numberValue: value, kind: 'numberValue' };
    case 'boolean':
      return { boolValue: value, kind: 'boolValue' };
    case 'object':
      return {
        structValue: toGrpcStruct(value as Record<string, unknown>),
        kind: 'structValue',
      };
    default:
      return { stringValue: String(value), kind: 'stringValue' };
  }
}

export function toGrpcStruct(value?: Record<string, unknown>): Record<string, unknown> {
  const fields = Object.entries(value || {}).reduce<Record<string, unknown>>((acc, [key, entry]) => {
    acc[key] = toGrpcValue(entry);
    return acc;
  }, {});
  return { fields };
}

export function buildGrpcHumanApprovalConfig(config?: { promptTemplate?: string; timeoutSeconds?: number | null } | null) {
  if (!config) return undefined;
  return {
    prompt_template: config.promptTemplate || '',
    ...(config.timeoutSeconds == null || config.timeoutSeconds === 0 ? {} : { timeout_seconds: config.timeoutSeconds }),
  };
}

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;
const RUNTIME_AGENT_METADATA_KEYS = [
  'agent_name',
  'agent_description',
  'agent_model',
  'agent_prompt',
  'agent_type',
  'agent_tools',
  'agent_params',
  'connector_bindings',
  'brain_context',
] as const;

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function shouldFinalizeStreamAsCompleted(
  completionEmitted: boolean,
  awaitingApproval: boolean,
  status: string,
): boolean {
  return !completionEmitted
    && !awaitingApproval
    && status !== 'cancelled'
    && status !== 'pending_approval'
    && status !== 'failed'
    && status !== 'completed';
}

export function shouldEmitFailureOnStreamError(completionEmitted: boolean): boolean {
  return !completionEmitted;
}

export function shouldEmitCompletedAfterUpdate(modifiedCount?: number): boolean {
  return Boolean(modifiedCount);
}

function stripRuntimeAgentMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitizedMetadata = { ...metadata };
  for (const key of RUNTIME_AGENT_METADATA_KEYS) {
    delete sanitizedMetadata[key];
  }
  return sanitizedMetadata;
}

const SINGLE_STEP_UNSUPPORTED_MESSAGE = 'Single-step execution only supports standalone step nodes without incoming edges or data bindings.';

@Injectable()
export class PlaybookFlowExecutionService implements OnModuleInit {
  private readonly logger = new Logger(PlaybookFlowExecutionService.name);
  private playbookFlowClient: any;
  private isGrpcAvailable = false;

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowRouterDecision.name)
    private readonly routerDecisionModel: Model<FlowRouterDecisionDocument>,
    private readonly configService: ConfigService,
    private readonly queueService: PlaybookFlowQueueService,
    private readonly idempotencyService: PlaybookFlowIdempotencyService,
    private readonly flowService: PlaybookFlowService,
    private readonly builderService: PlaybookFlowBuilderService,
    private readonly validatorService: PlaybookFlowValidatorService,
    private readonly agentService: AgentService,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
  ) {}

  onModuleInit() {
    this.initGrpcClient();
    if (this.isGrpcAvailable) {
      this.recoverQueuedExecutions()
        .catch((err) => {
          this.logger.error('Failed to recover queued executions', err instanceof Error ? err.stack : undefined);
        });
    }
  }

  private async reconcileOrphanedExecutions(): Promise<void> {
    // This remains disabled until execution ownership is persisted and validated.
  }

  private async recoverQueuedExecutions(): Promise<void> {
    const owners = await this.executionModel.distinct('ownerId', { status: 'queued' });
    for (const ownerId of owners as string[]) {
      while (true) {
        const queuedCount = await this.executionModel.countDocuments({ ownerId, status: 'queued' });
        const runningCount = await this.queueService.getRunningCount(ownerId);
        const maxConcurrent = this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 3);
        if (queuedCount === 0 || runningCount >= maxConcurrent) {
          break;
        }
        await this.drainQueue(ownerId);
      }
    }
  }

  private initGrpcClient() {
    try {
      const protoPath = this.resolvePlaybookFlowProtoPath();
      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
      const pfPackage = protoDescriptor.playbook_flow as any;
      const grpcUrl = this.configService.get<string>('playbook-flow.grpcUrl', 'localhost:50051');
      this.playbookFlowClient = new pfPackage.PlaybookFlowRuntime(
        grpcUrl,
        grpc.credentials.createInsecure(),
      );
      this.isGrpcAvailable = true;
      this.logger.log(`Playbook flow gRPC client initialized at ${grpcUrl}`);
    } catch (err) {
      this.isGrpcAvailable = false;
      this.logger.error('Failed to initialize playbook flow gRPC client', err instanceof Error ? err.stack : undefined);
    }
  }

  private resolvePlaybookFlowProtoPath(): string {
    const candidates = [
      path.join(__dirname, '..', 'proto', 'playbook-flow.proto'),
      path.join(__dirname, '..', '..', 'playbook-flow', 'proto', 'playbook-flow.proto'),
      path.join(process.cwd(), 'dist', 'modules', 'playbook-flow', 'proto', 'playbook-flow.proto'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[2];
  }

  async start(
    flowId: string,
    ownerId: string,
    inputContext?: Record<string, unknown>,
    idempotencyKey?: string,
    singleStepTaskId?: string,
  ): Promise<IFlowExecutionResponse> {
    const flow = await this.flowService.findOne(flowId, ownerId);

    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    const cleanedEdges = flow.controlEdges.filter((e) => {
      const valid = nodeIds.has(e.source) && nodeIds.has(e.target);
      if (!valid) {
        this.logger.warn(`Cleaning orphaned edge ${e.id}: source=${e.source} target=${e.target}`);
      }
      return valid;
    });
    const cleanedBindings = flow.dataBindings.filter((b) => {
      const valid = nodeIds.has(b.targetNode)
        && (b.sourceNode ? nodeIds.has(b.sourceNode) : true);
      if (!valid) {
        this.logger.warn(`Cleaning orphaned data binding ${b.id}: targetNode=${b.targetNode} sourceNode=${b.sourceNode}`);
      }
      return valid;
    });

    if (cleanedEdges.length !== flow.controlEdges.length || cleanedBindings.length !== flow.dataBindings.length) {
      this.logger.warn(
        `Cleaned ${flow.controlEdges.length - cleanedEdges.length} orphaned edge(s) and ${flow.dataBindings.length - cleanedBindings.length} orphaned binding(s) for flow ${flowId}`,
      );
      const doc = await this.flowService.findById(flowId);
      doc.controlEdges = cleanedEdges as any;
      doc.dataBindings = cleanedBindings as any;
      await doc.save();
      flow.controlEdges = cleanedEdges as any;
      flow.dataBindings = cleanedBindings as any;
    }

    this.validatorService.validate(flow.nodes, flow.controlEdges, flow.dataBindings);

    if (singleStepTaskId) {
      this.assertSingleStepSupported(flow.nodes, flow.controlEdges, flow.dataBindings, singleStepTaskId);
    }

    const maxConcurrent = this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 3);
    const maxDepth = this.configService.get<number>('playbook-flow.executionQueueMaxDepth', 50);
    const recursionLimit = flow.settings?.recursionLimit || 25;
    const maxParallelism = flow.settings?.maxParallelism || 5;

    if (idempotencyKey) {
      const reservation = await this.idempotencyService.reserve(ownerId, idempotencyKey, {
        flowId,
        inputContext: inputContext ?? {},
      });
      if (reservation.type === 'duplicate') {
        const existingExecution = await this.executionModel.findById(reservation.executionId);
        if (!existingExecution) {
          throw new ConflictException(
            ErrorCode.CONFLICT,
            'Idempotency record points to a missing execution. Retry with a new key.',
          );
        }
        return existingExecution.toJSON() as unknown as IFlowExecutionResponse;
      }
    }

    const fullSnapshot = this.builderService.buildSnapshot(flow as any);

    let snapshot: any;
    if (singleStepTaskId) {
      const allNodes = (fullSnapshot as any).nodes || [];
      const targetNode = allNodes.find((n: any) => n.id === singleStepTaskId);
      if (!targetNode) {
        throw new BadRequestException(
          ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
          `Single-step target node ${singleStepTaskId} not found`,
        );
      }
      snapshot = {
        ...fullSnapshot,
        nodes: [targetNode],
        controlEdges: [],
        dataBindings: [],
      };
    } else {
      snapshot = fullSnapshot;
    }

    const execution = new this.executionModel({
      flowId,
      ownerId,
      schemaVersion: 1,
      status: 'queued',
      recursionLimit,
      maxParallelism,
      inputContext,
      idempotencyKey,
      snapshot,
      singleStepTaskId: singleStepTaskId || undefined,
    });

    const saved = await execution.save();

    if (idempotencyKey) {
      try {
        await this.idempotencyService.confirmLink(ownerId, idempotencyKey, saved.id);
      } catch (err) {
        await this.executionModel.findByIdAndDelete(saved.id);
        await this.idempotencyService.release(ownerId, idempotencyKey);
        throw err;
      }
    }

    const position = await this.queueService.admit(ownerId, saved.id, maxConcurrent, maxDepth);
    if (position < 0) {
      await this.executionModel.findByIdAndDelete(saved.id);
      if (idempotencyKey) {
        await this.idempotencyService.release(ownerId, idempotencyKey);
      }
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_QUEUE_FULL,
        'Execution queue is full. Please try again later.',
      );
    }

    saved.queuePosition = position;
    await saved.save();

    await this.drainQueue(ownerId);

    return saved.toJSON() as unknown as IFlowExecutionResponse;
  }

  private assertSingleStepSupported(
    nodes: FlowNode[],
    controlEdges: ControlEdge[],
    dataBindings: DataBinding[],
    singleStepTaskId: string,
  ): void {
    const targetNode = nodes.find((node) => node.id === singleStepTaskId);
    if (!targetNode) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step target node ${singleStepTaskId} not found`,
      );
    }

    const kind = targetNode.kind;
    const containerConfig = (targetNode.metadata as { containerConfig?: { parentIteratorId?: string | null } } | undefined)?.containerConfig;
    const hasIncomingEdge = controlEdges.some((edge) => edge.target === singleStepTaskId);
    const hasTargetBinding = dataBindings.some((binding) => binding.targetNode === singleStepTaskId);

    if (kind !== 'step' || containerConfig?.parentIteratorId || hasIncomingEdge || hasTargetBinding) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        SINGLE_STEP_UNSUPPORTED_MESSAGE,
      );
    }
  }

  private async callGrpcRun(
    executionId: string,
    flowId: string,
    ownerId: string,
    flow: Record<string, unknown> | null,
    inputContext?: Record<string, unknown>,
    snapshotOverride?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const snapshot = (snapshotOverride || this.builderService.buildSnapshot((flow || {}) as any)) as any;
      const recursionLimit = snapshot.settings?.recursionLimit || 25;
      const maxParallelism = snapshot.settings?.maxParallelism || 5;

      // Resolve agents referenced by nodes and enrich metadata
      const agentIds = new Set<string>();
      for (const node of snapshot.nodes as any[]) {
        const assignedAgentId = node.metadata?.assignedAgentId;
        if (assignedAgentId && typeof assignedAgentId === 'string') {
          agentIds.add(assignedAgentId);
        }
      }
      const agentMap = new Map<string, Record<string, unknown>>();
      if (agentIds.size > 0) {
        const resolved = await this.agentService.buildGrpcAgentsForPlaybook(
          ownerId,
          [...agentIds],
          undefined,
        );
        for (const agent of resolved) {
          agentMap.set(agent.id, {
            agent_name: agent.name,
            agent_description: agent.description,
            agent_model: agent.chatbot?.model,
            agent_prompt: agent.prompt,
            agent_type: agent.agent_type,
            agent_tools: agent.tools,
            agent_params: agent.agent_params?.params || {},
            connector_bindings: agent.connector_bindings || [],
            brain_context: agent.brain_context || [],
          });
        }
      }
      // Merge resolved agent config into each node's metadata (flattened to avoid gRPC Struct nesting issues)
      const enrichedNodes = (snapshot.nodes as any[]).map((n) => {
        const assignedAgentId = n.metadata?.assignedAgentId;
        const resolvedAgent = typeof assignedAgentId === 'string' ? agentMap.get(assignedAgentId) : undefined;
        const baseMetadata = stripRuntimeAgentMetadata((n.metadata || {}) as Record<string, unknown>);
        const description = typeof n.description === 'string' && n.description.trim()
          ? n.description.trim()
          : typeof n.metadata?.description === 'string' && n.metadata.description.trim()
            ? n.metadata.description.trim()
            : '';
        return {
          ...n,
          modelId: n.modelId || (resolvedAgent?.agent_model as string) || '',
          metadata: {
            ...baseMetadata,
            ...(description ? { description } : {}),
            ...(resolvedAgent || {}),
          },
        };
      });

      const startResult = await this.executionModel.updateOne(
        { _id: executionId, status: 'running' },
        {
          startedAt: new Date(),
          queuePosition: 0,
        },
      ).exec();
      if (!(startResult as { modifiedCount?: number }).modifiedCount) {
        this.logger.warn(`Skipping gRPC start for execution ${executionId} because it is no longer runnable`);
        return;
      }

      this.streamEvents.emitExecutionStart(executionId, flowId, ownerId);

    this.logger.log(`Starting playbook flow execution ${executionId} with ${snapshot.nodes.length} nodes, ${agentIds.size} agent IDs found, ${agentMap.size} agents resolved`);

    for (const n of enrichedNodes) {
      if (n.metadata?.agent_name) {
        this.logger.debug(
          `[playbook-exec] enriched node ${n.id} agent=${n.metadata.agent_name} model=${n.metadata.agent_model} type=${n.metadata.agent_type}`,
        );
      }
    }

    const request = {
      execution_id: executionId,
      flow_id: flowId,
      owner_id: ownerId,
      snapshot: {
        nodes: (enrichedNodes as any[]).map((n) => ({
          id: n.id,
          kind: n.kind,
          label: n.label || '',
          task_template_id: n.taskTemplateId || '',
          prompt_template_id: n.promptTemplateId || '',
          output_format_id: n.outputFormatId || '',
          input: n.input ? {
            raw: n.input.raw || '',
            ports: (n.input.ports || []).map((p: Record<string, unknown>) => ({
              id: p.id || '',
              label: p.label || '',
              type: p.type || '',
              required: Boolean(p.required),
            })),
          } : undefined,
          output: n.output ? {
            raw: n.output.raw || '',
            ports: (n.output.ports || []).map((p: Record<string, unknown>) => ({
              id: p.id || '',
              label: p.label || '',
              type: p.type || '',
              required: Boolean(p.required),
            })),
          } : undefined,
          router_config: n.routerConfig ? {
            output_labels: n.routerConfig.outputLabels || [],
            max_iterations: n.routerConfig.maxIterations || 0,
            conditions: (n.routerConfig.conditions || []).map((condition: Record<string, unknown>) => ({
              label: condition.label || '',
              source_node: condition.sourceNode || '',
              source_port: condition.sourcePort || '',
              path: condition.path || '',
              operator: condition.operator || '',
              value: toGrpcValue(condition.value),
            })),
            default_label: n.routerConfig.defaultLabel || '',
          } : undefined,
          iterator_config: n.iteratorConfig ? {
            collection_path: n.iteratorConfig.collectionPath || '',
            max_items: n.iteratorConfig.maxItems || 0,
          } : undefined,
          human_approval_config: buildGrpcHumanApprovalConfig(n.humanApprovalConfig),
          retry_policy: n.retryPolicy ? {
            max_retries: n.retryPolicy.maxRetries || 0,
            delay_ms: n.retryPolicy.delayMs || 0,
          } : undefined,
          model_id: n.modelId || '',
          metadata: toGrpcStruct(n.metadata),
        })),
        control_edges: (snapshot.controlEdges as any[]).map((e) => ({
          id: e.id,
          kind: e.kind,
          source: e.source,
          target: e.target,
          router_label: e.routerLabel || '',
          priority: e.priority || 0,
          source_output_port_id: e.sourceOutputPortId || '',
          target_input_port_id: e.targetInputPortId || '',
        })),
        data_bindings: (snapshot.dataBindings as any[]).map((b) => ({
          id: b.id,
          target_node: b.targetNode,
          target_port: b.targetPort,
          source_kind: b.sourceKind,
          source_node: b.sourceNode || '',
          source_port: b.sourcePort || '',
          iteration: b.iteration || '',
          trigger_path: b.triggerPath || '',
          state_path: b.statePath || '',
          constant_value: toGrpcValue(b.constantValue),
          expression: b.expression || '',
        })),
        settings: {
          recursion_limit: recursionLimit,
          max_parallelism: maxParallelism,
        },
      },
      input_context: toGrpcStruct(inputContext),
      settings: {
        recursion_limit: recursionLimit,
        max_parallelism: maxParallelism,
      },
    };

    const call = this.playbookFlowClient.Run(request);
    let finalized = false;
    let completionEmitted = false;
    let lastHandlePromise = Promise.resolve();
    const releaseOnce = () => {
      if (finalized) return;
      finalized = true;
      this.drainQueue(ownerId);
    };
    call.on('data', (event: Record<string, unknown>) => {
      lastHandlePromise = lastHandlePromise
        .then(() => this.handleRunEvent(executionId, event))
        .catch((err) => {
          this.logger.error(`Failed to handle run event for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
        });
      const eventType = event.event_type as string;
      if (eventType === 'ExecutionCompleted') {
        completionEmitted = true;
      } else if (eventType === 'ExecutionFailed') {
        completionEmitted = true;
      }
    });
    call.on('error', (err: Error) => {
      void (async () => {
        this.logger.error(`gRPC stream error for execution ${executionId}: ${err.message}`, err.stack);
        await this.executionModel
          .findByIdAndUpdate(executionId, { status: 'failed', endedAt: new Date(), error: err.message })
          .exec();
        if (!completionEmitted) {
          this.streamEvents.emitExecutionComplete(executionId, 'failed', err.message);
          completionEmitted = true;
        }
        releaseOnce();
      })().catch((updateErr) => {
        this.logger.error(`Failed to finalize errored stream for execution ${executionId}`, updateErr instanceof Error ? updateErr.stack : undefined);
        releaseOnce();
      });
    });
    call.on('end', () => {
      void (async () => {
        this.logger.log(`gRPC stream ended for execution ${executionId}`);
        await lastHandlePromise;
        if (!completionEmitted) {
          const execution = await this.executionModel.findById(executionId).lean();
          const status = String((execution as Record<string, unknown> | null)?.status || '');
          if (shouldFinalizeStreamAsCompleted(false, false, status)) {
            const failedTask = await this.taskResultModel
              .findOne({ executionId, status: 'failed' })
              .sort({ endedAt: -1 })
              .lean();

            if (failedTask) {
              const errorMessage = String(failedTask.error || 'Execution failed');
              const result = await this.executionModel
                .updateOne(
                  { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
                  { status: 'failed', error: errorMessage, endedAt: new Date() },
                )
                .exec();
              if ((result as { modifiedCount?: number }).modifiedCount) {
                completionEmitted = true;
                this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
              }
            } else {
              const result = await this.executionModel
                .updateOne(
                  { _id: executionId, status: { $in: ['queued', 'running'] } },
                  { status: 'completed', endedAt: new Date() },
                )
                .exec();
              if ((result as { modifiedCount?: number }).modifiedCount) {
                completionEmitted = true;
                this.streamEvents.emitExecutionComplete(executionId, 'completed');
              }
            }
          }
        }
        releaseOnce();
      })().catch((err) => {
        this.logger.error(`Failed to finalize gRPC stream for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
        releaseOnce();
      });
    });
    } catch (err) {
      this.logger.error(`Playbook flow execution ${executionId} failed before gRPC stream`, err instanceof Error ? err.stack : undefined);
      await this.executionModel.findByIdAndUpdate(executionId, {
        status: 'failed',
        endedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      }).exec();
      this.streamEvents.emitExecutionComplete(executionId, 'failed', err instanceof Error ? err.message : String(err));
      await this.drainQueue(ownerId);
    }
  }

  private unwrapGrpcValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;

    if (Array.isArray(value)) return value.map((v) => this.unwrapGrpcValue(v));

    const obj = value as Record<string, unknown>;

    // Selector-less protobuf Struct: { fields: { … } }
    if (!obj.kind && typeof obj.fields === 'object' && obj.fields !== null && !Array.isArray(obj.fields)) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj.fields as Record<string, unknown>)) {
        result[k] = this.unwrapGrpcValue(v);
      }
      return result;
    }

    // Selector-less protobuf Value: { stringValue, numberValue, … }
    if (!obj.kind && 'stringValue' in obj) return obj.stringValue ?? '';
    if (!obj.kind && 'numberValue' in obj) return obj.numberValue ?? 0;
    if (!obj.kind && 'boolValue' in obj) return Boolean(obj.boolValue);
    if (!obj.kind && 'nullValue' in obj) return null;
    if (!obj.kind && 'listValue' in obj && typeof obj.listValue === 'object' && obj.listValue !== null) {
      const values = (obj.listValue as Record<string, unknown>).values;
      if (Array.isArray(values)) return values.map((v) => this.unwrapGrpcValue(v));
    }
    if (!obj.kind && 'structValue' in obj && typeof obj.structValue === 'object' && obj.structValue !== null) {
      const fields = (obj.structValue as Record<string, unknown>).fields;
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
          result[k] = this.unwrapGrpcValue(v);
        }
        return result;
      }
    }

    // Kind-tagged protobuf Value: { kind: "structValue", … }
    if (obj.kind === 'structValue' && typeof obj.structValue === 'object' && obj.structValue !== null) {
      const fields = (obj.structValue as Record<string, unknown>).fields;
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
          result[k] = this.unwrapGrpcValue(v);
        }
        return result;
      }
    }

    if (obj.kind === 'listValue' && typeof obj.listValue === 'object' && obj.listValue !== null) {
      const values = (obj.listValue as Record<string, unknown>).values;
      if (Array.isArray(values)) return values.map((v) => this.unwrapGrpcValue(v));
    }

    if (obj.kind === 'numberValue') return obj.numberValue ?? 0;
    if (obj.kind === 'stringValue') return obj.stringValue ?? '';
    if (obj.kind === 'boolValue') return Boolean(obj.boolValue);
    if (obj.kind === 'nullValue') return null;

    // Already a plain object (proto-loader auto-unwrapped) — recurse children
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = this.unwrapGrpcValue(v);
    }
    return result;
  }

  private async handleRunEvent(executionId: string, event: Record<string, unknown>): Promise<void> {
    const eventType = event.event_type as string;
    const rawPayload = (event.payload as Record<string, unknown>) || {};
    const payload = (this.unwrapGrpcValue(rawPayload) as Record<string, unknown>) || {};
    const taskNodeId = event.node_id as string;
    const iteration = Number(event.iteration ?? payload.iteration ?? 0);

    this.logger.debug(`Received playbook flow event ${eventType} for execution ${executionId}`);

    if (eventType === 'NodeStarted') {
      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'running',
            startedAt: new Date(),
          },
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
          },
        },
        { upsert: true },
      );
      this.streamEvents.emitStepStart(executionId, taskNodeId);
    } else if (eventType === 'NodeToken') {
      const token = String(payload.token ?? '');
      if (token) {
        await this.taskResultModel.updateOne(
          { executionId, taskId: taskNodeId, iteration },
          [
            {
              $set: {
                status: 'running',
                output: {
                  $concat: [{ $ifNull: ['$output', ''] }, token],
                },
              },
            },
          ],
          { upsert: true },
        );
        this.streamEvents.emitStepUpdate(executionId, taskNodeId, token);
      }
    } else if (eventType === 'NodeCompleted') {
      const rawOutput = payload.output ?? payload;
      const cleanOutput = this.unwrapGrpcValue(rawOutput);

      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'completed',
            output: typeof cleanOutput === 'object' && cleanOutput !== null
              ? JSON.stringify(cleanOutput)
              : String(cleanOutput ?? ''),
            error: null,
            endedAt: new Date(),
          },
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
            startedAt: new Date(),
          },
        },
        { upsert: true },
      );
      this.streamEvents.emitStepComplete(
        executionId,
        taskNodeId,
        typeof cleanOutput === 'string' ? cleanOutput : JSON.stringify(cleanOutput),
      );
    } else if (eventType === 'NodeFailed') {
      const errorMessage = String(payload.error || 'Node execution failed');
      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'failed',
            error: errorMessage,
            endedAt: new Date(),
          },
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
            startedAt: new Date(),
          },
        },
        { upsert: true },
      );
      this.streamEvents.emitStepComplete(executionId, taskNodeId, undefined, errorMessage, iteration);
    } else if (eventType === 'RouterDecision') {
      const label = String(payload.label || '');
      await this.routerDecisionModel.create({
        executionId,
        routerNodeId: taskNodeId,
        iteration,
        label,
        decidedAt: new Date(),
      });
      this.streamEvents.emitRouterDecision(executionId, taskNodeId, label, iteration);

      if (RESERVED_LABELS.includes(label as any)) {
        this.logger.warn(
          `Execution ${executionId} reached reserved label '${label}' via router ${taskNodeId} iteration ${iteration}`,
        );

        const terminalStatus = label === '__error__' ? 'failed' : 'cancelled';
        const errorMsg = label === '__error__' ? `Router ${taskNodeId} returned __error__` : `Router ${taskNodeId} returned __cancelled__`;

        const result = await this.executionModel
          .updateOne(
            { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
            { status: terminalStatus, error: errorMsg, endedAt: new Date() },
          )
          .exec();

        if ((result as { modifiedCount?: number }).modifiedCount) {
          this.streamEvents.emitExecutionComplete(executionId, terminalStatus, errorMsg);

          const execution = await this.executionModel.findById(executionId, { ownerId: 1 }).lean();
          const owner = execution ? (execution as unknown as Record<string, unknown>).ownerId as string : undefined;
          if (owner) {
            this.drainQueue(owner).catch((err) => {
              this.logger.error(`Failed to drain queue after ${label} for owner ${owner}`, err instanceof Error ? err.stack : undefined);
            });
          }
        }
      }
    } else if (eventType === 'ApprovalRequested') {
      const result = await this.executionModel
        .updateOne(
          { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
          {
            status: 'pending_approval',
            pendingApproval: {
              nodeId: String(payload.node_id || taskNodeId),
              iteration,
              prompt: String(payload.prompt || ''),
              requestedAt: new Date(),
            },
          },
        )
        .exec();
      if ((result as { modifiedCount?: number }).modifiedCount) {
        this.streamEvents.emitInterrupt(
          executionId,
          String(payload.node_id || taskNodeId),
          String(payload.prompt || ''),
          iteration,
          executionId,
        );
      }
    } else if (eventType === 'ExecutionCompleted') {
      const result = await this.executionModel
        .updateOne(
          { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
          { status: 'completed', endedAt: new Date() },
        )
        .exec();
      if (shouldEmitCompletedAfterUpdate((result as { modifiedCount?: number }).modifiedCount)) {
        this.streamEvents.emitExecutionComplete(executionId, 'completed');
      }
    } else if (eventType === 'ExecutionFailed') {
      const errorMessage = String(payload.error || 'Execution failed');
      const result = await this.executionModel
        .updateOne(
          { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
          { status: 'failed', error: errorMessage, endedAt: new Date() },
        )
        .exec();
      if ((result as { modifiedCount?: number }).modifiedCount) {
        this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
      }
    }
  }

  async findAll(
    flowId: string,
    ownerId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<IFlowExecutionListResponse> {
    const filter: Record<string, unknown> = { flowId, ownerId };
    const total = await this.executionModel.countDocuments(filter);
    const items = await this.executionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return {
      items: items.map((item) => ({
        ...item,
        id: (item as unknown as Record<string, unknown>)._id as string,
      })) as unknown as IFlowExecutionResponse[],
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(executionId: string, ownerId: string): Promise<IFlowExecutionDetailResponse> {
    const execution = await this.executionModel.findById(executionId);
    if (!execution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }

    const taskResults = await this.taskResultModel
      .find({ executionId })
      .sort({ taskId: 1, iteration: 1 })
      .lean();

    const routerDecisions = await this.routerDecisionModel
      .find({ executionId })
      .sort({ decidedAt: 1 })
      .lean();

    return {
      ...(execution.toJSON() as unknown as IFlowExecutionResponse),
      taskResults: taskResults.map((r) => ({
        id: (r as unknown as Record<string, unknown>)._id as string,
        executionId: r.executionId,
        taskId: r.taskId,
        iteration: r.iteration,
        status: r.status,
        output: r.output,
        error: r.error,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
      })),
      routerDecisions: routerDecisions.map((r) => ({
        id: (r as unknown as Record<string, unknown>)._id as string,
        executionId: r.executionId,
        routerNodeId: r.routerNodeId,
        iteration: r.iteration,
        label: r.label,
        decidedAt: r.decidedAt,
      })),
    };
  }

  private async drainQueue(ownerId: string): Promise<void> {
    const maxConcurrent = this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 3);
    if (!this.isGrpcAvailable) return;

    while (true) {
      const next = await this.queueService.release(ownerId, maxConcurrent);
      if (!next) return;

      const changes = await this.queueService.refreshPositions(ownerId);
      for (const { executionId, queuePosition } of changes) {
        this.streamEvents.emitQueuePositionUpdate(executionId, queuePosition);
      }

      const snapshot = (next as unknown as Record<string, unknown>).snapshot as Record<string, unknown> | undefined;
      let flow: Record<string, unknown> | null = null;

      if (!snapshot) {
        flow = await this.flowService.findOne(next.flowId, ownerId).catch((err) => {
          this.logger.warn(`Drain: flow ${next.flowId} not found for execution ${next.id}`, String(err));
          return null;
        }) as unknown as Record<string, unknown> | null;

        if (!flow) {
          await this.executionModel
            .findByIdAndUpdate(next.id, {
              status: 'failed',
              endedAt: new Date(),
              error: 'Flow not found before runtime start',
            })
            .exec();
          this.streamEvents.emitExecutionComplete(next.id, 'failed', 'Flow not found before runtime start');
          continue;
        }
      }

      this.logger.log(`Drain: starting queued execution ${next.id} for owner ${ownerId}`);
      this.callGrpcRun(next.id, next.flowId, ownerId, flow, next.inputContext, snapshot).catch((err) => {
        this.logger.error(`Drain: execution ${next.id} failed to start`, err instanceof Error ? err.stack : undefined);
      });
    }
  }

  async cancel(executionId: string, ownerId: string): Promise<IFlowExecutionResponse> {
    const execution = await this.executionModel.findById(executionId);
    if (!execution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }

    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Execution already finished');
    }

    execution.status = 'cancelled';
    execution.endedAt = new Date();
    await execution.save();

    if (this.isGrpcAvailable) {
      this.playbookFlowClient.Cancel({ execution_id: executionId }, (err: Error | null) => {
        if (err) {
        }
      });
    }

    return execution.toJSON() as unknown as IFlowExecutionResponse;
  }

  async delete(executionId: string, ownerId: string): Promise<void> {
    const execution = await this.executionModel.findById(executionId);
    if (!execution || String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }

    if (execution.status === 'running') {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Cannot delete a running execution. Cancel it first.',
      );
    }

    await this.taskResultModel.deleteMany({ executionId });
    await this.routerDecisionModel.deleteMany({ executionId });
    await this.executionModel.findByIdAndDelete(executionId);
  }

  async deleteAll(flowId: string, ownerId: string): Promise<{ deleted: number }> {
    const flow = await this.flowService.findOne(flowId, ownerId);

    const executions = await this.executionModel.find({ flowId, ownerId }, { _id: 1 }).lean();
    const executionIds = executions.map((e: Record<string, unknown>) => String(e._id));

    if (executionIds.length > 0) {
      await this.taskResultModel.deleteMany({ executionId: { $in: executionIds } });
      await this.routerDecisionModel.deleteMany({ executionId: { $in: executionIds } });
    }

    const result = await this.executionModel.deleteMany({ flowId, ownerId });
    return { deleted: result.deletedCount ?? 0 };
  }

  async resumeApproval(
    executionId: string,
    ownerId: string,
    payload: IResumeApprovalPayload,
  ): Promise<IFlowExecutionResponse> {
    const execution = await this.executionModel.findById(executionId);
    if (!execution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (execution.status !== 'pending_approval') {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_APPROVAL_NOT_FOUND,
        'No pending approval for this execution',
      );
    }

    if (!this.isGrpcAvailable) {
      throw new ServiceUnavailableException(
        ErrorCode.PLAYBOOK_FLOW_GRPC_UNAVAILABLE,
        'Flow runtime is currently unavailable',
      );
    }

    const resumed = await new Promise<boolean>((resolve, reject) => {
      this.playbookFlowClient.ResumeApproval(
        {
          execution_id: executionId,
          decision: payload.decision,
          payload: toGrpcStruct(payload.payload || {}),
        },
        (err: Error | null, response?: { resumed?: boolean }) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(Boolean(response?.resumed));
        },
      );
    });

    if (!resumed) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution could not be resumed because the runtime no longer has the pending approval state.',
      );
    }

    const resumeUpdate = await this.executionModel.updateOne(
      { _id: executionId, status: 'pending_approval' },
      {
        status: 'running',
        pendingApproval: null,
      },
    ).exec();

    if (!(resumeUpdate as { modifiedCount?: number }).modifiedCount) {
      const latestExecution = await this.executionModel.findById(executionId);
      if (!latestExecution) {
        throw new NotFoundException(
          ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
          'Execution not found',
        );
      }
      return latestExecution.toJSON() as unknown as IFlowExecutionResponse;
    }

    execution.pendingApproval = null;
    execution.status = 'running';
    return execution.toJSON() as unknown as IFlowExecutionResponse;
  }
}

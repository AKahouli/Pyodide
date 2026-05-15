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
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '../../exceptions/exceptions/http.exceptions';
import {
  IFlowExecutionResponse,
  IFlowExecutionDetailResponse,
  IFlowExecutionListResponse,
  IFlowTaskResultResponse,
  IFlowRouterDecisionResponse,
  IResumeApprovalPayload,
} from '../interfaces/playbook-flow-execution.interface';

function toGrpcValue(value: unknown): Record<string, unknown> {
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

function toGrpcStruct(value?: Record<string, unknown>): Record<string, unknown> {
  const fields = Object.entries(value || {}).reduce<Record<string, unknown>>((acc, [key, entry]) => {
    acc[key] = toGrpcValue(entry);
    return acc;
  }, {});
  return { fields };
}

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
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.initGrpcClient();
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
  ): Promise<IFlowExecutionResponse> {
    const flow = await this.flowService.findOne(flowId, ownerId);

    const maxConcurrent = this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 3);
    const maxDepth = this.configService.get<number>('playbook-flow.executionQueueMaxDepth', 50);
    const recursionLimit = flow.settings?.recursionLimit || 25;
    const maxParallelism = flow.settings?.maxParallelism || 5;

    const execution = new this.executionModel({
      flowId,
      ownerId,
      schemaVersion: 1,
      status: 'queued',
      recursionLimit,
      maxParallelism,
      inputContext,
      idempotencyKey,
    });

    const saved = await execution.save();

    const position = await this.queueService.enqueue(ownerId, saved.id, maxConcurrent, maxDepth);
    if (position < 0) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_QUEUE_FULL,
        'Execution queue is full. Please try again later.',
      );
    }

    saved.queuePosition = position;
    await saved.save();

    if (this.isGrpcAvailable) {
      this.callGrpcRun(saved.id, flowId, ownerId, flow as any, inputContext).catch((err) => {
        this.logger.error(`Playbook flow execution ${saved.id} failed to start`, err instanceof Error ? err.stack : undefined);
      });
    } else {
      this.logger.warn(`Playbook flow execution ${saved.id} not started because gRPC client is unavailable`);
    }

    return saved.toJSON() as unknown as IFlowExecutionResponse;
  }

  private async callGrpcRun(
    executionId: string,
    flowId: string,
    ownerId: string,
    flow: Record<string, unknown>,
    inputContext?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const snapshot = this.builderService.buildSnapshot(flow as any);
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
          });
        }
      }
      // Merge resolved agent config into each node's metadata (flattened to avoid gRPC Struct nesting issues)
      const enrichedNodes = (snapshot.nodes as any[]).map((n) => {
        const assignedAgentId = n.metadata?.assignedAgentId;
        const resolvedAgent = typeof assignedAgentId === 'string' ? agentMap.get(assignedAgentId) : undefined;
        return {
          ...n,
          metadata: {
            ...(n.metadata || {}),
            ...(resolvedAgent || {}),
          },
        };
      });

      await this.executionModel.findByIdAndUpdate(executionId, {
        status: 'running',
        startedAt: new Date(),
        queuePosition: 0,
      }).exec();

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
          } : undefined,
          iterator_config: n.iteratorConfig ? {
            collection_path: n.iteratorConfig.collectionPath || '',
            max_items: n.iteratorConfig.maxItems || 0,
          } : undefined,
          human_approval_config: n.humanApprovalConfig ? {
            prompt_template: n.humanApprovalConfig.promptTemplate || '',
            timeout_seconds: n.humanApprovalConfig.timeoutSeconds || 0,
          } : undefined,
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
    const releaseOnce = () => {
      if (finalized) return;
      finalized = true;
      this.queueService.release(ownerId);
    };
    call.on('data', (event: Record<string, unknown>) => {
      this.handleRunEvent(executionId, event).catch((err) => {
        this.logger.error(`Failed to handle run event for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
      });
    });
    call.on('error', (err: Error) => {
      this.logger.error(`gRPC stream error for execution ${executionId}: ${err.message}`, err.stack);
      this.executionModel
        .findByIdAndUpdate(executionId, { status: 'failed', endedAt: new Date(), error: err.message })
        .exec();
      releaseOnce();
    });
    call.on('end', () => {
      this.logger.log(`gRPC stream ended for execution ${executionId}`);
      this.executionModel
        .updateOne(
          { _id: executionId, status: { $in: ['queued', 'running'] } },
          { status: 'completed', endedAt: new Date() },
        )
        .exec();
      releaseOnce();
    });
    } catch (err) {
      this.logger.error(`Playbook flow execution ${executionId} failed before gRPC stream`, err instanceof Error ? err.stack : undefined);
      await this.executionModel.findByIdAndUpdate(executionId, {
        status: 'failed',
        endedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      }).exec();
      this.queueService.release(ownerId);
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
    const payload = (event.payload as Record<string, unknown>) || {};
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
    } else if (eventType === 'NodeFailed') {
      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'failed',
            error: String(payload.error || 'Node execution failed'),
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
      await this.executionModel.findByIdAndUpdate(executionId, {
        status: 'failed',
        error: String(payload.error || 'Node execution failed'),
        endedAt: new Date(),
      }).exec();
    } else if (eventType === 'RouterDecision') {
      await this.routerDecisionModel.create({
        executionId,
        routerNodeId: taskNodeId,
        iteration,
        label: String(payload.label || ''),
        decidedAt: new Date(),
      });
    } else if (eventType === 'ApprovalRequested') {
      await this.executionModel.findByIdAndUpdate(executionId, {
        status: 'pending_approval',
        pendingApproval: {
          nodeId: String(payload.node_id || taskNodeId),
          iteration,
          prompt: String(payload.prompt || ''),
          requestedAt: new Date(),
        },
      }).exec();
    } else if (eventType === 'ExecutionCompleted') {
      await this.executionModel.findByIdAndUpdate(executionId, {
        status: 'completed',
        endedAt: new Date(),
      }).exec();
    } else if (eventType === 'ExecutionFailed') {
      await this.executionModel.findByIdAndUpdate(executionId, {
        status: 'failed',
        error: String(payload.error || 'Execution failed'),
        endedAt: new Date(),
      }).exec();
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

    this.queueService.release(ownerId);
    return execution.toJSON() as unknown as IFlowExecutionResponse;
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

    execution.pendingApproval = null;
    await execution.save();

    if (this.isGrpcAvailable) {
      this.playbookFlowClient.ResumeApproval(
        {
          execution_id: executionId,
          decision: payload.decision,
          payload: toGrpcStruct(payload.payload || {}),
        },
        (err: Error | null) => {
          if (err) {
          }
        },
      );
    }

    return execution.toJSON() as unknown as IFlowExecutionResponse;
  }
}

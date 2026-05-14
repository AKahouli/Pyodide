import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'node:path';
import * as fs from 'node:fs';
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

@Injectable()
export class PlaybookFlowExecutionService implements OnModuleInit {
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
    } catch (err) {
      this.isGrpcAvailable = false;
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
      this.callGrpcRun(saved.id, flowId, ownerId, flow as any, inputContext).catch(() => {});
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
    const snapshot = this.builderService.buildSnapshot(flow as any);

    const request = {
      execution_id: executionId,
      flow_id: flowId,
      owner_id: ownerId,
      snapshot: {
        nodes: (snapshot.nodes as any[]).map((n) => ({
          id: n.id,
          kind: n.kind,
          label: n.label || '',
          task_template_id: n.taskTemplateId || '',
          prompt_template_id: n.promptTemplateId || '',
          output_format_id: n.outputFormatId || '',
          metadata: n.metadata || {},
        })),
        control_edges: (snapshot.controlEdges as any[]).map((e) => ({
          id: e.id,
          kind: e.kind,
          source: e.source,
          target: e.target,
          router_label: e.routerLabel || '',
        })),
        data_bindings: (snapshot.dataBindings as any[]).map((b) => ({
          id: b.id,
          target_node: b.targetNode,
          target_port: b.targetPort,
          source_kind: b.sourceKind,
          source_node: b.sourceNode || '',
          source_port: b.sourcePort || '',
        })),
        settings: {
          recursion_limit: snapshot.settings?.recursionLimit || 25,
          max_parallelism: snapshot.settings?.maxParallelism || 5,
        },
      },
      input_context: inputContext || {},
      settings: {
        recursion_limit: 25,
        max_parallelism: 5,
      },
    };

    const call = this.playbookFlowClient.Run(request);
    call.on('data', (event: Record<string, unknown>) => {
      this.handleRunEvent(executionId, event).catch(() => {});
    });
    call.on('error', (err: Error) => {
      this.executionModel
        .findByIdAndUpdate(executionId, { status: 'failed', endedAt: new Date() })
        .exec();
    });
    call.on('end', () => {
      this.executionModel
        .findByIdAndUpdate(executionId, { status: 'completed', endedAt: new Date() })
        .exec();
      this.queueService.release(ownerId);
    });
  }

  private async handleRunEvent(executionId: string, event: Record<string, unknown>): Promise<void> {
    const eventType = event.event_type as string;
    if (eventType === 'NodeCompleted') {
      const payload = event.payload as Record<string, unknown> || {};
      const taskNodeId = event.node_id as string;
      const iteration = (event.iteration as number) || 0;

      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
            status: 'completed',
            output: payload.output || {},
            startedAt: new Date(),
            endedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } else if (eventType === 'RouterDecision') {
      await this.routerDecisionModel.create({
        executionId,
        routerNodeId: event.node_id,
        iteration: (event.iteration as number) || 0,
        label: (event.payload as Record<string, string>)?.label || '',
        decidedAt: new Date(),
      });
    } else if (eventType === 'ApprovalRequested') {
      await this.executionModel.findByIdAndUpdate(executionId, { status: 'pending_approval' });
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
          payload: payload.payload || {},
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

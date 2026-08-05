import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyTask,
  WorkyTaskDocument,
} from '../schemas/worky-task.schema';
import {
  WorkyEphemeralWorker,
  WorkyEphemeralWorkerDocument,
} from '../schemas/worky-ephemeral-worker.schema';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { AgentRepository } from '../../agent/repositories/agent.repository';
import { LoggerService } from '../../logger';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyAuditService } from './worky-audit.service';
import { WorkyEventService } from './worky-event.service';
import { WorkyGovernanceService } from './worky-governance.service';
import { WORKY_MANAGER_AGENT_TYPE_SLUG } from '../constants/worky.constants';

export interface IWorkyWorkerBinding {
  ephemeralWorkerId: string;
  agentEntityId: string;
  adkSessionId: string | null;
  adkInvocationId: string | null;
  scopedToolRefs: string[];
  withheldToolRefs: string[];
  role: string;
}

interface BindForTaskInput {
  streamId: string;
  taskId: string;
  role: string;
  toolRefs: string[];
}

/**
 * Ephemeral AI worker binding (Part 3, canonical §3.5 + §4.3).
 *
 * On every `POST /worky/internal/streams/{id}/spawn-worker`:
 *   - Validate the requested tool refs against the stream's governance
 *     policy. Tools for a gated category (`approval` / `hard_block`) are
 *     withheld from the worker until the owner responds. The LLM cannot
 *     self-approve; the runtime re-binds after approval.
 *   - Create a fresh `Agent` entity scoped to the stream's owner and
 *     bound to only the non-withheld tools. The agent is *ephemeral* —
 *     the runtime is expected to retire it after the task is done.
 *   - Persist a `WorkyEphemeralWorker` row + audit + SSE event.
 *   - Return a `WorkerBinding` wire shape the runtime can pass to its
 *     `AgentTool(agent=..., tools=...)` factory.
 */
@Injectable()
export class WorkyEphemeralWorkerService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    @InjectModel(WorkyEphemeralWorker.name)
    private readonly workers: Model<WorkyEphemeralWorkerDocument>,
    private readonly agentRepository: AgentRepository,
    private readonly governance: WorkyGovernanceService,
    private readonly events: WorkyEventService,
    private readonly audit: WorkyAuditService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyEphemeralWorkerService.name);
  }

  async bindForTask(input: BindForTaskInput): Promise<IWorkyWorkerBinding> {
    const stream = await this.streams.findById(input.streamId).lean().exec();
    if (!stream) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    if (!Types.ObjectId.isValid(input.taskId)) {
      throw new BadRequestException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
    const task = await this.tasks
      .findOne({ _id: new Types.ObjectId(input.taskId), streamId: stream._id })
      .lean()
      .exec();
    if (!task) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }

    const allowed: string[] = [];
    const withheld: string[] = [];
    for (const ref of input.toolRefs) {
      // Each tool ref maps to a category via the convention
      // `<type>:<name>` where the category is the first segment for
      // external-facing tool families, otherwise `internal_analysis`.
      const category = this.categoryForToolRef(ref, task.actionCategory);
      const resolution = await this.governance.resolve(stream._id.toString(), category, null);
      if (resolution.resolvedLevel === 'hard_block') {
        withheld.push(ref);
        continue;
      }
      if (resolution.resolvedLevel === 'approval') {
        // Withhold until owner responds; the runtime will re-spawn.
        withheld.push(ref);
        continue;
      }
      allowed.push(ref);
    }

    // Create the scoped Agent entity. We use the existing Manager agent
    // type — the runtime will use the agent's `tools` field to know
    // what's bound. The slug is unique per (owner, role, suffix).
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentName = `Worky Worker — ${input.role} (${suffix})`.slice(0, 50);
    const slug = `worky-ephemeral-${suffix}`.slice(0, 100);
    const managerAgentTypeId = stream.managerAgentId
      ? (await this.agentRepository.findById(String(stream.managerAgentId)))?.agentType ?? new Types.ObjectId().toString()
      : new Types.ObjectId().toString();
    const agent = await this.agentRepository.create({
      id: new Types.ObjectId().toString(),
      name: agentName,
      slug,
      agentType: managerAgentTypeId,
      agentTypeSlug: '',
      role: `Ephemeral worker for task ${input.taskId}.`,
      description: `Auto-created by the Worky stream runtime for a single task.`,
      temperature: 0,
      llmModel: '',
      instruction: `You are an ephemeral AI worker for Worky task "${task.title}".`,
      ignorePrePrompt: false,
      knowledgeBases: [],
      tools: [],
      skills: [],
      disabledSkills: [],
      connectors: [],
      connectorActionSelections: [],
      guardrails: {},
      deploymentSettings: {},
      enable_temporary_child_agents: false,
      max_temporary_child_agents: 4,
      isDefault: false,
      isDefaultForType: false,
      isActive: true,
      createdBy: String(stream.ownerUserId),
    });

    const worker = await this.workers.create({
      streamId: stream._id,
      taskId: new Types.ObjectId(input.taskId),
      agentEntityId: new Types.ObjectId(agent._id),
      role: input.role,
      status: 'spawned',
      adkSessionId: null,
      adkInvocationId: null,
    });

    await this.audit.append({
      streamId: stream._id.toString(),
      actorUserId: null,
      action: 'worker.spawned',
      targetType: 'task',
      targetId: input.taskId,
      details: {
        ephemeralWorkerId: (worker._id as Types.ObjectId).toString(),
        agentEntityId: agent._id,
        allowed,
        withheld,
        role: input.role,
      },
    });

    this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
      type: 'worker.spawned',
      emittedAt: Date.now(),
      payload: {
        taskId: input.taskId,
        ephemeralWorkerId: (worker._id as Types.ObjectId).toString(),
        agentEntityId: agent._id,
        withheld,
      },
    });

    return {
      ephemeralWorkerId: (worker._id as Types.ObjectId).toString(),
      agentEntityId: agent._id,
      adkSessionId: null,
      adkInvocationId: null,
      scopedToolRefs: allowed,
      withheldToolRefs: withheld,
      role: input.role,
    };
  }

  /**
   * Mark a worker as done. The runtime calls this when the
   * `AgentTool` returns; the worker row stays in Mongo for audit.
   */
  async retire(ephemeralWorkerId: string, status: 'done' | 'failed' | 'canceled'): Promise<void> {
    if (!Types.ObjectId.isValid(ephemeralWorkerId)) {
      throw new NotFoundException(
        ErrorCode.WORKY_WORKER_BINDING_FAILED,
        'Ephemeral worker id is invalid.',
      );
    }
    await this.workers
      .updateOne({ _id: new Types.ObjectId(ephemeralWorkerId) }, { $set: { status } })
      .exec();
  }

  private categoryForToolRef(ref: string, fallback: string): string {
    if (ref.startsWith('connector:') || ref.startsWith('tool:')) {
      return 'external_send';
    }
    if (ref.startsWith('skill:')) {
      return 'internal_artifact_write';
    }
    return fallback;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '../../exceptions/exceptions/http.exceptions';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { IFlowResponse, IFlowListResponse } from '../interfaces/playbook-flow.interface';

@Injectable()
export class PlaybookFlowService {
  private readonly logger = new Logger(PlaybookFlowService.name);

  private normalizeWorkspaces(workspaces?: string[]): string[] {
    return workspaces
      ?.map((workspaceId) => workspaceId.trim())
      .filter((workspaceId) => workspaceId.length > 0)
      .slice(0, 1)
      ?? [];
  }

  private ensureWorkspaceSelection(workspaces: string[]): void {
    if (workspaces.length === 0) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Select a default playbook workspace before saving this playbook.',
      );
    }
  }

  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    private readonly validatorService: PlaybookFlowValidatorService,
  ) {}

  async create(ownerId: string, dto: CreatePlaybookFlowDto): Promise<IFlowResponse> {
    const nodes = dto.nodes || [];
    const controlEdges = dto.controlEdges || [];
    const dataBindings = dto.dataBindings || [];
    const workspaces = this.normalizeWorkspaces(dto.workspaces);

    this.ensureWorkspaceSelection(workspaces);

    this.validatorService.validate(nodes as any, controlEdges as any, dataBindings as any, { allowDraftRouters: true });

    const flow = new this.flowModel({
      ownerId,
      schemaVersion: 1,
      name: dto.name,
      description: dto.description,
      triggerConfig: dto.triggerConfig,
      settings: dto.settings || { recursionLimit: 25, maxParallelism: 5 },
      nodes,
      controlEdges,
      dataBindings,
      workspaces,
    });

    try {
      const saved = await flow.save();
      return saved.toJSON() as unknown as IFlowResponse;
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(
          ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
          `A playbook named "${dto.name}" already exists.`,
        );
      }
      throw err;
    }
  }

  async findAll(ownerId: string, query: PlaybookFlowQueryDto): Promise<IFlowListResponse> {
    const { page = 1, limit = 10, sortBy = 'updatedAt', sortOrder = 'desc', search } = query;

    const filter: Record<string, unknown> = { ownerId };
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const sortDir = sortOrder === 'asc' ? 1 : -1;
    const total = await this.flowModel.countDocuments(filter);
    const items = await this.flowModel
      .find(filter)
      .sort({ [sortBy]: sortDir })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return {
      items: items.map((item) => ({
        ...item,
        id: (item as unknown as Record<string, unknown>)._id as string,
      })) as unknown as IFlowResponse[],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(flowId: string, ownerId: string): Promise<IFlowResponse> {
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    const flow = await this.flowModel.findById(flowId);
    if (!flow) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(flow.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }
    return flow.toJSON() as unknown as IFlowResponse;
  }

  async update(flowId: string, ownerId: string, dto: UpdatePlaybookFlowDto): Promise<IFlowResponse> {
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    const existing = await this.flowModel.findById(flowId);
    if (!existing) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(existing.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }

    if (dto.name !== undefined) existing.name = dto.name;
    if (dto.description !== undefined) existing.description = dto.description;
    if (dto.triggerConfig !== undefined) existing.triggerConfig = dto.triggerConfig as any;
    if (dto.settings !== undefined) existing.settings = dto.settings as any;
    if (dto.nodes !== undefined) existing.nodes = dto.nodes as any[];
    if (dto.controlEdges !== undefined) existing.controlEdges = dto.controlEdges as any[];
    if (dto.dataBindings !== undefined) existing.dataBindings = dto.dataBindings as any[];
    const normalizedWorkspaces = this.normalizeWorkspaces(dto.workspaces ?? existing.workspaces);
    if (dto.workspaces !== undefined || existing.workspaces.length > 1) {
      this.ensureWorkspaceSelection(normalizedWorkspaces);
    }
    existing.workspaces = normalizedWorkspaces;

    const effectiveNodeIds = new Set(existing.nodes.map((n: any) => n.id));

    const edgeCountBefore = existing.controlEdges.length;
    existing.controlEdges = existing.controlEdges.filter((e: any) => {
      const valid = effectiveNodeIds.has(e.source) && effectiveNodeIds.has(e.target);
      if (!valid) {
        this.logger.warn(`Removing orphaned edge ${e.id}: source=${e.source} target=${e.target}`);
      }
      return valid;
    });
    if (existing.controlEdges.length < edgeCountBefore) {
      this.logger.warn(`Removed ${edgeCountBefore - existing.controlEdges.length} orphaned edge(s)`);
    }

    const bindingCountBefore = existing.dataBindings.length;
    existing.dataBindings = existing.dataBindings.filter((b: any) => {
      const valid = effectiveNodeIds.has(b.targetNode)
        && (b.sourceNode ? effectiveNodeIds.has(b.sourceNode) : true);
      if (!valid) {
        this.logger.warn(`Removing orphaned data binding ${b.id}: targetNode=${b.targetNode} sourceNode=${b.sourceNode}`);
      }
      return valid;
    });
    if (existing.dataBindings.length < bindingCountBefore) {
      this.logger.warn(`Removed ${bindingCountBefore - existing.dataBindings.length} orphaned data binding(s)`);
    }

    this.validatorService.validate(
      existing.nodes as any,
      existing.controlEdges as any,
      existing.dataBindings as any,
      { allowDraftRouters: true },
    );

    const saved = await existing.save();
    return saved.toJSON() as unknown as IFlowResponse;
  }

  async findById(flowId: string): Promise<FlowDocument> {
    const flow = await this.flowModel.findById(flowId);
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    return flow;
  }

  async createWithNodesAndEdges(
    ownerId: string, name: string, description: string,
    nodes: any[], controlEdges: any[], dataBindings: any[],
    workspaces: string[] = [],
  ): Promise<IFlowResponse> {
    const normalizedWorkspaces = this.normalizeWorkspaces(workspaces);

    this.ensureWorkspaceSelection(normalizedWorkspaces);

    this.validatorService.validate(nodes as any, controlEdges as any, dataBindings as any, { allowDraftRouters: true });

    const flow = new this.flowModel({
      ownerId, schemaVersion: 1, name, description,
      nodes, controlEdges, dataBindings, workspaces: normalizedWorkspaces,
      settings: { recursionLimit: 25, maxParallelism: 5 },
    });
    try {
      const saved = await flow.save();
      return saved.toJSON() as unknown as IFlowResponse;
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(
          ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
          `A playbook named "${name}" already exists.`,
        );
      }
      throw err;
    }
  }

  async updateNodesAndEdges(
    flowId: string, update: { nodes?: any[]; controlEdges?: any[]; dataBindings?: any[] },
  ): Promise<IFlowResponse> {
    if (update.nodes || update.controlEdges || update.dataBindings) {
      const existing = await this.flowModel.findById(flowId);
      if (!existing) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND);
      if (update.nodes) existing.nodes = update.nodes;
      if (update.controlEdges) existing.controlEdges = update.controlEdges;
      if (update.dataBindings) existing.dataBindings = update.dataBindings;
      existing.workspaces = this.normalizeWorkspaces(existing.workspaces);
      this.ensureWorkspaceSelection(existing.workspaces);
      this.validatorService.validate(
        existing.nodes as any,
        existing.controlEdges as any,
        existing.dataBindings as any,
        { allowDraftRouters: true },
      );
      const saved = await existing.save();
      return saved.toJSON() as unknown as IFlowResponse;
    }
    return this.findOne(flowId, '');
  }

  async remove(flowId: string, ownerId: string): Promise<void> {
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    const flow = await this.flowModel.findById(flowId);
    if (!flow) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(flow.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }
    await this.flowModel.findByIdAndDelete(flowId);
  }

  async clone(flowId: string, ownerId: string, nameSuffix?: string): Promise<IFlowResponse> {
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    const existing = await this.flowModel.findById(flowId);
    if (!existing) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(existing.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }

    const cloneName = nameSuffix ? `${existing.name} ${nameSuffix}` : `${existing.name} (copy)`;
    const normalizedWorkspaces = this.normalizeWorkspaces(existing.workspaces);

    this.ensureWorkspaceSelection(normalizedWorkspaces);

    const flow = new this.flowModel({
      ownerId,
      schemaVersion: existing.schemaVersion,
      name: cloneName,
      description: existing.description,
      triggerConfig: existing.triggerConfig,
      settings: existing.settings,
      nodes: existing.nodes,
      controlEdges: existing.controlEdges,
      dataBindings: existing.dataBindings,
      workspaces: normalizedWorkspaces,
    });

    try {
      const saved = await flow.save();
      return saved.toJSON() as unknown as IFlowResponse;
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(
          ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
          `A playbook named "${cloneName}" already exists.`,
        );
      }
      throw err;
    }
  }

  async findAllWithTriggerKind(kind: string): Promise<Array<{ id: string; ownerId: string; triggerConfig: any }>> {
    const flows = await this.flowModel
      .find({ 'triggerConfig.kind': kind })
      .select('ownerId triggerConfig')
      .lean()
      .exec();
    return flows.map((f) => ({
      id: (f as any)._id.toString(),
      ownerId: f.ownerId,
      triggerConfig: f.triggerConfig,
    }));
  }

  async toggleFavorite(flowId: string, ownerId: string): Promise<{ isFavorite: boolean }> {
    const flow = await this.flowModel.findById(flowId);
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND);
    if (String(flow.ownerId) !== String(ownerId)) throw new ForbiddenException(ErrorCode.FORBIDDEN);
    const current = flow.get('isFavorite') === true;
    flow.set('isFavorite', !current);
    await flow.save();
    return { isFavorite: !current };
  }

  async bulkDelete(ids: string[], ownerId: string): Promise<{ deleted: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'No IDs provided');
    }
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'No valid IDs provided');
    }
    const result = await this.flowModel.deleteMany({
      _id: { $in: validIds.map((id) => new Types.ObjectId(id)) },
      ownerId,
    });
    return { deleted: result.deletedCount ?? 0 };
  }

  async getActiveExecutions(ownerId: string): Promise<any[]> {
    return this.executionModel
      .find({ ownerId, status: { $in: ['queued', 'running', 'pending_approval'] } })
      .sort({ createdAt: -1 })
      .lean();
  }

  async cloneShare(flowId: string, ownerId: string, emails: string[]): Promise<{ clone?: IFlowResponse; shared: string[] }> {
    const clone = await this.clone(flowId, ownerId, ' (shared)');
    return { clone, shared: emails };
  }
}

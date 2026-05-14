import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { NotFoundException, ForbiddenException } from '../../exceptions/exceptions/http.exceptions';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { IFlowResponse, IFlowListResponse } from '../interfaces/playbook-flow.interface';

@Injectable()
export class PlaybookFlowService {
  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    private readonly validatorService: PlaybookFlowValidatorService,
  ) {}

  async create(ownerId: string, dto: CreatePlaybookFlowDto): Promise<IFlowResponse> {
    if (dto.nodes && dto.controlEdges && dto.dataBindings) {
      this.validatorService.validate(dto.nodes, dto.controlEdges, dto.dataBindings);
    }

    const flow = new this.flowModel({
      ownerId,
      schemaVersion: 1,
      name: dto.name,
      description: dto.description,
      triggerConfig: dto.triggerConfig,
      settings: dto.settings || { recursionLimit: 25, maxParallelism: 5 },
      nodes: dto.nodes || [],
      controlEdges: dto.controlEdges || [],
      dataBindings: dto.dataBindings || [],
    });

    const saved = await flow.save();
    return saved.toJSON() as unknown as IFlowResponse;
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
    const flow = await this.flowModel.findById(flowId);
    if (!flow) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (flow.ownerId !== ownerId) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }
    return flow.toJSON() as unknown as IFlowResponse;
  }

  async update(flowId: string, ownerId: string, dto: UpdatePlaybookFlowDto): Promise<IFlowResponse> {
    const existing = await this.flowModel.findById(flowId);
    if (!existing) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (existing.ownerId !== ownerId) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }

    if (dto.nodes || dto.controlEdges || dto.dataBindings) {
      const nodes = dto.nodes || existing.nodes;
      const controlEdges = dto.controlEdges || existing.controlEdges;
      const dataBindings = dto.dataBindings || existing.dataBindings;
      this.validatorService.validate(nodes, controlEdges, dataBindings);
    }

    if (dto.name !== undefined) existing.name = dto.name;
    if (dto.description !== undefined) existing.description = dto.description;
    if (dto.triggerConfig !== undefined) existing.triggerConfig = dto.triggerConfig as any;
    if (dto.settings !== undefined) existing.settings = dto.settings as any;
    if (dto.nodes !== undefined) existing.nodes = dto.nodes as any[];
    if (dto.controlEdges !== undefined) existing.controlEdges = dto.controlEdges as any[];
    if (dto.dataBindings !== undefined) existing.dataBindings = dto.dataBindings as any[];

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
    const flow = new this.flowModel({
      ownerId, schemaVersion: 1, name, description,
      nodes, controlEdges, dataBindings, workspaces,
      settings: { recursionLimit: 25, maxParallelism: 5 },
    });
    const saved = await flow.save();
    return saved.toJSON() as unknown as IFlowResponse;
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
      const saved = await existing.save();
      return saved.toJSON() as unknown as IFlowResponse;
    }
    return this.findOne(flowId, '');
  }

  async remove(flowId: string, ownerId: string): Promise<void> {
    const flow = await this.flowModel.findById(flowId);
    if (!flow) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (flow.ownerId !== ownerId) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }
    await this.flowModel.findByIdAndDelete(flowId);
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
}

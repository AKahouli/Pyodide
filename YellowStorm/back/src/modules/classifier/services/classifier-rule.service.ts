import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ClassifierRule,
  ClassifierRuleDocument,
  ClassifierRuleScope,
} from '../schemas/classifier-rule.schema';
import { CreateRuleDto } from '../dto/create-rule.dto';
import { UpdateRuleDto } from '../dto/update-rule.dto';
import { ListRulesQueryDto } from '../dto/list-rules-query.dto';
import { IClassifierRuleResponse } from '../interfaces/classifier.interface';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import { ClassifierAccessService } from './classifier-access.service';

@Injectable()
export class ClassifierRuleService {
  constructor(
    @InjectModel(ClassifierRule.name)
    private readonly ruleModel: Model<ClassifierRuleDocument>,
    private readonly access: ClassifierAccessService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ClassifierRuleService.name);
  }

  async list(
    userId: string,
    query: ListRulesQueryDto,
  ): Promise<IClassifierRuleResponse[]> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };

    if (query.scope) {
      filter.scope = query.scope;
    }

    if (query.scope === ClassifierRuleScope.LOCAL) {
      if (!query.workspaceId) {
        throw new BadRequestException(ErrorCode.CLASSIFIER_RULE_INVALID_SCOPE);
      }
      await this.access.assertWorkspaceAccess(query.workspaceId, userId);
      filter.workspaceId = new Types.ObjectId(query.workspaceId);
    } else if (query.scope === ClassifierRuleScope.GLOBAL) {
      filter.workspaceId = null;
    } else if (query.workspaceId) {
      // No scope specified but workspaceId given: filter strictly to that workspace
      await this.access.assertWorkspaceAccess(query.workspaceId, userId);
      filter.workspaceId = new Types.ObjectId(query.workspaceId);
    }

    const rules = await this.ruleModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return rules.map((r) => this.toResponse(r));
  }

  async create(
    userId: string,
    dto: CreateRuleDto,
  ): Promise<IClassifierRuleResponse> {
    if (dto.scope === ClassifierRuleScope.LOCAL && !dto.workspaceId) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_RULE_INVALID_SCOPE);
    }
    if (dto.scope === ClassifierRuleScope.GLOBAL && dto.workspaceId) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_RULE_INVALID_SCOPE);
    }

    if (dto.workspaceId) {
      await this.access.assertWorkspaceAccess(dto.workspaceId, userId);
    }

    const rule = await this.ruleModel.create({
      userId: new Types.ObjectId(userId),
      scope: dto.scope,
      workspaceId: dto.workspaceId ? new Types.ObjectId(dto.workspaceId) : null,
      text: dto.text.trim(),
      enabled: dto.enabled ?? true,
    });

    this.logger.log('Classifier rule created', {
      ruleId: rule._id.toString(),
      scope: rule.scope,
      workspaceId: rule.workspaceId?.toString() ?? null,
      userId,
    });

    return this.toResponse(rule);
  }

  async update(
    userId: string,
    ruleId: string,
    dto: UpdateRuleDto,
  ): Promise<IClassifierRuleResponse> {
    const rule = await this.getOwnedRule(userId, ruleId);

    if (dto.text !== undefined) {
      rule.text = dto.text.trim();
    }
    if (dto.enabled !== undefined) {
      rule.enabled = dto.enabled;
    }

    await rule.save();
    return this.toResponse(rule);
  }

  async delete(userId: string, ruleId: string): Promise<void> {
    const rule = await this.getOwnedRule(userId, ruleId);
    await this.ruleModel.deleteOne({ _id: rule._id }).exec();
    this.logger.log('Classifier rule deleted', {
      ruleId: rule._id.toString(),
      userId,
    });
  }

  /**
   * Returns the active rules (global + local) that apply to a given workspace run.
   * Used by ClassifierRunService when starting a run to inject rules into the hint.
   */
  async getActiveForWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<IClassifierRuleResponse[]> {
    const rules = await this.ruleModel
      .find({
        userId: new Types.ObjectId(userId),
        enabled: true,
        $or: [
          { scope: ClassifierRuleScope.GLOBAL, workspaceId: null },
          {
            scope: ClassifierRuleScope.LOCAL,
            workspaceId: new Types.ObjectId(workspaceId),
          },
        ],
      })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    return rules.map((r) => this.toResponse(r));
  }

  // ───────── helpers ─────────

  private async getOwnedRule(
    userId: string,
    ruleId: string,
  ): Promise<ClassifierRuleDocument> {
    if (!Types.ObjectId.isValid(ruleId)) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_RULE_NOT_FOUND);
    }
    const rule = await this.ruleModel.findById(ruleId).exec();
    if (!rule) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_RULE_NOT_FOUND);
    }
    if (rule.userId.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.CLASSIFIER_RULE_FORBIDDEN);
    }
    return rule;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): IClassifierRuleResponse {
    return {
      id: (doc._id as { toString(): string }).toString(),
      userId: (doc.userId as { toString(): string }).toString(),
      scope: doc.scope as 'global' | 'local',
      workspaceId: doc.workspaceId
        ? (doc.workspaceId as { toString(): string }).toString()
        : null,
      text: doc.text as string,
      enabled: Boolean(doc.enabled),
      createdAt:
        doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt:
        doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }
}

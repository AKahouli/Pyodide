import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ClassifierRuleRepository } from '../persistence/classifier-rule.repository';
import { ClassifierRuleScope, type ClassifierRuleRecord } from '../classifier.types';
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
    private readonly rules: ClassifierRuleRepository,
    private readonly access: ClassifierAccessService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ClassifierRuleService.name);
  }

  async list(
    userId: string,
    query: ListRulesQueryDto,
  ): Promise<IClassifierRuleResponse[]> {
    let workspaceId: string | null | undefined;

    if (query.scope === ClassifierRuleScope.LOCAL) {
      if (!query.workspaceId) {
        throw new BadRequestException(ErrorCode.CLASSIFIER_RULE_INVALID_SCOPE);
      }
      await this.access.assertWorkspaceAccess(query.workspaceId, userId);
      workspaceId = query.workspaceId;
    } else if (query.scope === ClassifierRuleScope.GLOBAL) {
      workspaceId = null;
    } else if (query.workspaceId) {
      // No scope specified but workspaceId given: filter strictly to that workspace
      await this.access.assertWorkspaceAccess(query.workspaceId, userId);
      workspaceId = query.workspaceId;
    }

    const rules = await this.rules.listForUser(userId, { scope: query.scope, workspaceId });
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

    const rule = await this.rules.create({
      userId,
      scope: dto.scope,
      workspaceId: dto.workspaceId ?? null,
      text: dto.text.trim(),
      enabled: dto.enabled ?? true,
    });

    this.logger.log('Classifier rule created', {
      ruleId: rule.id,
      scope: rule.scope,
      workspaceId: rule.workspaceId,
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

    const patch: { text?: string; enabled?: boolean } = {};
    if (dto.text !== undefined) {
      patch.text = dto.text.trim();
    }
    if (dto.enabled !== undefined) {
      patch.enabled = dto.enabled;
    }
    if (Object.keys(patch).length === 0) {
      return this.toResponse(rule);
    }

    const updated = await this.rules.update(rule.id, patch);
    if (!updated) throw new NotFoundException(ErrorCode.CLASSIFIER_RULE_NOT_FOUND);
    return this.toResponse(updated);
  }

  async delete(userId: string, ruleId: string): Promise<void> {
    const rule = await this.getOwnedRule(userId, ruleId);
    await this.rules.delete(rule.id);
    this.logger.log('Classifier rule deleted', {
      ruleId: rule.id,
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
    const rules = await this.rules.listActiveForWorkspace(userId, workspaceId);
    return rules.map((r) => this.toResponse(r));
  }

  // ───────── helpers ─────────

  private async getOwnedRule(
    userId: string,
    ruleId: string,
  ): Promise<ClassifierRuleRecord> {
    if (!isObjectId(ruleId)) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_RULE_NOT_FOUND);
    }
    const rule = await this.rules.findById(ruleId);
    if (!rule) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_RULE_NOT_FOUND);
    }
    if (rule.userId !== userId) {
      throw new ForbiddenException(ErrorCode.CLASSIFIER_RULE_FORBIDDEN);
    }
    return rule;
  }

  private toResponse(rule: ClassifierRuleRecord): IClassifierRuleResponse {
    return {
      id: rule.id,
      userId: rule.userId,
      scope: rule.scope,
      workspaceId: rule.workspaceId,
      text: rule.text,
      enabled: rule.enabled,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}

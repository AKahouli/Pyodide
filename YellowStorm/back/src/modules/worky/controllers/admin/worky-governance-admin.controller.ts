import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { WorkyGovernanceService } from '../../services/worky-governance.service';
import { UpsertWorkyGovernancePolicyDto } from '../../dto/worky-governance-policy.dto';
import { RequirePermissions } from '../../../authorization/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions } from '../../../authorization/constants/permissions';
import { LoggerService } from '../../../logger';
import { BadRequestException, NotFoundException } from '../../../exceptions';
import { ErrorCode } from '../../../exceptions/constants/error-codes';
import { Types } from 'mongoose';

interface IWorkyGovernancePolicyResponse {
  workspaceId: string;
  scope: string;
  defaultLevel: string;
  categories: Array<{ category: string; level: string }>;
  allowStreamOwnerOverride: boolean;
  maxOwnerRelaxLevel: string;
}

@ApiTags('Worky Admin')
@ApiBearerAuth()
@Controller('worky/admin/governance-policy')
export class WorkyGovernanceAdminController {
  constructor(
    private readonly governance: WorkyGovernanceService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyGovernanceAdminController.name);
  }

  @Get()
  @RequirePermissions(Permissions.WORKY_ADMIN_GOVERNANCE)
  @ApiOperation({ summary: 'Read the workspace governance policy' })
  async get(@Query('workspaceId') workspaceId: string): Promise<IWorkyGovernancePolicyResponse> {
    if (!workspaceId) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'workspaceId is required.');
    }
    if (!Types.ObjectId.isValid(workspaceId)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid workspaceId.');
    }
    const policy = await this.governance.findPolicy(workspaceId);
    if (!policy) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'No governance policy has been set for this workspace yet.',
      );
    }
    return this.toResponse(policy);
  }

  @Post()
  @RequirePermissions(Permissions.WORKY_ADMIN_GOVERNANCE)
  @ApiOperation({ summary: 'Upsert the workspace governance policy' })
  async upsert(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertWorkyGovernancePolicyDto,
  ): Promise<IWorkyGovernancePolicyResponse> {
    const policy = await this.governance.upsertWorkspacePolicy(user._id.toString(), {
      workspaceId: dto.workspaceId,
      defaultLevel: dto.defaultLevel as never,
      categories: dto.categories.map((c) => ({
        category: c.category,
        level: c.level as never,
      })),
      allowStreamOwnerOverride: dto.allowStreamOwnerOverride ?? true,
      maxOwnerRelaxLevel: (dto.maxOwnerRelaxLevel ?? 'notify') as never,
    });
    return this.toResponse(policy);
  }

  private toResponse(policy: {
    workspaceId: Types.ObjectId;
    scope: string;
    defaultLevel: string;
    categories: Array<{ category: string; level: string }>;
    allowStreamOwnerOverride: boolean;
    maxOwnerRelaxLevel: string;
  }): IWorkyGovernancePolicyResponse {
    return {
      workspaceId: policy.workspaceId.toString(),
      scope: policy.scope,
      defaultLevel: policy.defaultLevel,
      categories: (policy.categories ?? []).map((c) => ({
        category: c.category,
        level: c.level,
      })),
      allowStreamOwnerOverride: Boolean(policy.allowStreamOwnerOverride),
      maxOwnerRelaxLevel: policy.maxOwnerRelaxLevel,
    };
  }
}

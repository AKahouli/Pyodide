import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { CreateGovernanceScopeDto, UpdateGovernanceScopeDto } from '../dto';
import { GovernanceScopeOverview, GovernanceScopeOverviewService } from '../services/governance-scope-overview.service';
import { GovernanceScopeResponse, GovernanceScopeService } from '../services/governance-scope.service';

@ApiTags('Governance Scopes')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs/:programId/scopes')
export class GovernanceScopeController {
  constructor(private readonly scopeService: GovernanceScopeService, private readonly scopeOverviewService: GovernanceScopeOverviewService) {}

  @Get()
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'List governance scopes for a program' })
  async listScopes(@CurrentUser() user: UserDocument, @Param('programId') programId: string): Promise<GovernanceScopeResponse[]> {
    return this.scopeService.list(user._id.toString(), programId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions([Permissions.GOVERNANCE_SCOPES_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Create a governance scope' })
  @ApiResponse({ status: 201, description: 'Governance scope created' })
  async createScope(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Body() dto: CreateGovernanceScopeDto,
  ): Promise<GovernanceScopeResponse> {
    return this.scopeService.create(user._id.toString(), programId, dto);
  }

  @Get(':scopeId/overview')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Get a scope-centric governance overview' })
  @ApiParam({ name: 'scopeId', description: 'Governance scope ID' })
  async getScopeOverview(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('scopeId') scopeId: string,
  ): Promise<GovernanceScopeOverview> {
    return this.scopeOverviewService.getOverview(user._id.toString(), programId, scopeId);
  }

  @Get(':scopeId')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Get a governance scope' })
  @ApiParam({ name: 'scopeId', description: 'Governance scope ID' })
  async getScope(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('scopeId') scopeId: string,
  ): Promise<GovernanceScopeResponse> {
    return this.scopeService.findById(user._id.toString(), programId, scopeId);
  }

  @Patch(':scopeId')
  @RequirePermissions([Permissions.GOVERNANCE_SCOPES_MANAGE, Permissions.GOVERNANCE_REVIEWS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Update a governance scope' })
  async updateScope(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('scopeId') scopeId: string,
    @Body() dto: UpdateGovernanceScopeDto,
  ): Promise<GovernanceScopeResponse> {
    return this.scopeService.update(user._id.toString(), user.email, programId, scopeId, dto);
  }

  @Delete(':scopeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.GOVERNANCE_SCOPES_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Delete a governance scope' })
  async deleteScope(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('scopeId') scopeId: string,
  ): Promise<void> {
    return this.scopeService.delete(user._id.toString(), programId, scopeId);
  }
}

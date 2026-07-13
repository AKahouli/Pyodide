import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { CreateGovernanceWorkspaceBindingDto, UpdateGovernanceWorkspaceBindingDto } from '../dto/create-governance-workspace-binding.dto';
import { GovernanceWorkspaceBindingService } from '../services/governance-workspace-binding.service';
import { GovernanceWorkspaceReconciliationService } from '../services/governance-workspace-reconciliation.service';

@ApiTags('Governance Workspace Bindings')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs/:programId/workspace-bindings')
export class GovernanceWorkspaceBindingController {
  constructor(private readonly bindings: GovernanceWorkspaceBindingService, private readonly reconciliation: GovernanceWorkspaceReconciliationService) {}
  @Post() @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  create(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Body() dto: CreateGovernanceWorkspaceBindingDto) { return this.bindings.create(user._id.toString(), programId, dto); }
  @Get() @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  list(@CurrentUser() user: UserDocument, @Param('programId') programId: string) { return this.bindings.list(user._id.toString(), programId); }
  @Get(':bindingId') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  find(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('bindingId') bindingId: string) { return this.bindings.find(user._id.toString(), programId, bindingId); }
  @Patch(':bindingId') @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  update(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('bindingId') bindingId: string, @Body() dto: UpdateGovernanceWorkspaceBindingDto) { return this.bindings.update(user._id.toString(), programId, bindingId, dto); }
  @Delete(':bindingId') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  remove(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('bindingId') bindingId: string) { return this.bindings.delete(user._id.toString(), programId, bindingId); }
  @Post(':bindingId/reconcile') @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  async reconcile(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('bindingId') bindingId: string, @Body() body: { dryRun?: boolean }) { await this.bindings.assertAccessible(user._id.toString(), programId, bindingId); return this.reconciliation.reconcileBinding(bindingId, body.dryRun !== false); }
}

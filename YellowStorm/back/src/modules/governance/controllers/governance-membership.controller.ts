import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { CreateGovernanceMembershipDto, UpdateGovernanceMembershipDto } from '../dto';
import { GovernanceMembershipResponse, GovernanceMembershipService } from '../services/governance-membership.service';

@ApiTags('Governance Memberships')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs/:programId/memberships')
export class GovernanceMembershipController {
  constructor(private readonly membershipService: GovernanceMembershipService) {}

  @Get()
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'List governance memberships for a program' })
  async list(@CurrentUser() user: UserDocument, @Param('programId') programId: string): Promise<GovernanceMembershipResponse[]> {
    return this.membershipService.list(user._id.toString(), programId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions([Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Create a governance membership' })
  async create(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Body() dto: CreateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    return this.membershipService.create(user._id.toString(), user.email, programId, dto);
  }

  @Patch(':membershipId')
  @RequirePermissions([Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Update a governance membership' })
  async update(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('membershipId') membershipId: string, @Body() dto: UpdateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    return this.membershipService.update(user._id.toString(), user.email, programId, membershipId, dto);
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Disable a governance membership' })
  async disable(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('membershipId') membershipId: string): Promise<void> {
    return this.membershipService.disable(user._id.toString(), user.email, programId, membershipId);
  }
}

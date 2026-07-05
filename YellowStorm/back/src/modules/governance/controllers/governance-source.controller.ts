import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { CreateGovernanceSourceDto, UpdateGovernanceSourceDto } from '../dto';
import { GovernanceSourceResponse, GovernanceSourceService } from '../services/governance-source.service';

@ApiTags('Governance Sources')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs/:programId/sources')
export class GovernanceSourceController {
  constructor(private readonly sourceService: GovernanceSourceService) {}

  @Get()
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'List governance sources for a program' })
  async listSources(@CurrentUser() user: UserDocument, @Param('programId') programId: string): Promise<GovernanceSourceResponse[]> {
    return this.sourceService.list(user._id.toString(), programId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Create a governance source' })
  @ApiResponse({ status: 201, description: 'Governance source created' })
  async createSource(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Body() dto: CreateGovernanceSourceDto,
  ): Promise<GovernanceSourceResponse> {
    return this.sourceService.create(user._id.toString(), programId, dto);
  }

  @Get(':sourceId')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Get a governance source' })
  @ApiParam({ name: 'sourceId', description: 'Governance source ID' })
  async getSource(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<GovernanceSourceResponse> {
    return this.sourceService.findById(user._id.toString(), programId, sourceId);
  }

  @Patch(':sourceId')
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Update a governance source' })
  async updateSource(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateGovernanceSourceDto,
  ): Promise<GovernanceSourceResponse> {
    return this.sourceService.update(user._id.toString(), programId, sourceId, dto);
  }

  @Delete(':sourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Delete a governance source' })
  async deleteSource(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<void> {
    return this.sourceService.delete(user._id.toString(), programId, sourceId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { GovernanceProgramResponse, GovernanceProgramService } from '../services/governance-program.service';
import { CreateGovernanceProgramDto, UpdateGovernanceProgramDto } from '../dto';

@ApiTags('Governance Programs')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs')
export class GovernanceProgramController {
  constructor(private readonly programService: GovernanceProgramService) {}

  @Get()
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'List governance programs owned by the current user' })
  async listPrograms(@CurrentUser() user: UserDocument): Promise<GovernanceProgramResponse[]> {
    return this.programService.listForOwner(user._id.toString());
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions([Permissions.GOVERNANCE_PROGRAMS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Create a governance program' })
  @ApiResponse({ status: 201, description: 'Governance program created' })
  async createProgram(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateGovernanceProgramDto,
  ): Promise<GovernanceProgramResponse> {
    return this.programService.create(user._id.toString(), dto);
  }

  @Get(':programId')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Get a governance program' })
  @ApiParam({ name: 'programId', description: 'Governance program ID' })
  async getProgram(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
  ): Promise<GovernanceProgramResponse> {
    return this.programService.findById(user._id.toString(), programId);
  }

  @Patch(':programId')
  @RequirePermissions([Permissions.GOVERNANCE_PROGRAMS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Update a governance program' })
  async updateProgram(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Body() dto: UpdateGovernanceProgramDto,
  ): Promise<GovernanceProgramResponse> {
    return this.programService.update(user._id.toString(), programId, dto);
  }

  @Delete(':programId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.GOVERNANCE_PROGRAMS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Delete an empty governance program' })
  async deleteProgram(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
  ): Promise<void> {
    return this.programService.delete(user._id.toString(), programId);
  }
}

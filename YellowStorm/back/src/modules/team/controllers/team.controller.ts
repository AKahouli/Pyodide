import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TeamService } from '../team.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { CreateTeamDto, UpdateTeamDto, QueryTeamDto, UpdateHierarchyDto, GenerateTeamDto } from '../dto';
import { ITeamResponse, ITeamWithAgentsResponse } from '../interfaces/team.interface';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto';

@ApiTags('Teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user teams (paginated)' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryTeamDto,
  ): Promise<PaginatedResponseDto<ITeamResponse>> {
    return this.teamService.findUserTeams(user._id.toString(), query);
  }

  @Get('all')
  @ApiOperation({ summary: 'List all active teams of the current user (unpaginated)' })
  async findAllForUser(@CurrentUser() user: AuthUser): Promise<ITeamResponse[]> {
    return this.teamService.findAllForUser(user._id.toString());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a team by id (members enriched with agent details)' })
  async findById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<ITeamWithAgentsResponse> {
    return this.teamService.findUserTeamById(user._id.toString(), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a team' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTeamDto,
  ): Promise<ITeamResponse> {
    return this.teamService.create(user._id.toString(), dto);
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a team and its hierarchy from a prompt (AI)' })
  async generate(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateTeamDto,
  ): Promise<ITeamWithAgentsResponse> {
    return this.teamService.generateTeam(user._id.toString(), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a team' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<ITeamResponse> {
    return this.teamService.update(user._id.toString(), id, dto);
  }

  @Patch(':id/hierarchy')
  @ApiOperation({ summary: 'Replace the full team hierarchy (org-chart save)' })
  async updateHierarchy(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateHierarchyDto,
  ): Promise<ITeamResponse> {
    return this.teamService.updateHierarchy(user._id.toString(), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a team' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.teamService.delete(user._id.toString(), id);
  }
}

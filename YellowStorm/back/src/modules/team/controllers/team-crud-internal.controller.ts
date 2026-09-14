import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { InternalServiceGuard } from '../../auth/guards/internal-service.guard';
import { AgentCrudActorGuard, actingUserIdFrom } from '../../auth/guards/agent-crud-actor.guard';
import { TeamService } from '../team.service';
import { CreateTeamDto, UpdateTeamDto, UpdateHierarchyDto } from '../dto';
import { ITeamResponse, ITeamWithAgentsResponse } from '../interfaces/team.interface';

/**
 * Trusted service-to-service team CRUD surface for the mcp-agent MCP server
 * (Streamable HTTP connector `agent-mcp`). Runs as the acting user from the
 * trusted identity headers.
 */
@ApiTags('Team CRUD Internal')
@Public()
@Controller('internal/agent-crud')
@UseGuards(InternalServiceGuard, AgentCrudActorGuard)
export class TeamCrudInternalController {
  constructor(private readonly teamService: TeamService) {}

  @Get('teams')
  @ApiOperation({ summary: 'List all active teams visible to the acting user' })
  async listTeams(@Req() request: { headers: Record<string, string | string[] | undefined> }): Promise<ITeamResponse[]> {
    return this.teamService.findAllForUser(actingUserIdFrom(request.headers));
  }

  @Get('teams/:id')
  @ApiOperation({ summary: 'Get one team with its member agents and hierarchy' })
  async getTeam(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Param('id') id: string,
  ): Promise<ITeamWithAgentsResponse> {
    return this.teamService.findUserTeamById(actingUserIdFrom(request.headers), id);
  }

  @Post('teams')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a team owned by the acting user' })
  async createTeam(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Body() dto: CreateTeamDto,
  ): Promise<ITeamResponse> {
    return this.teamService.create(actingUserIdFrom(request.headers), dto);
  }

  @Patch('teams/:id')
  @ApiOperation({ summary: 'Update team metadata or reconcile its agent list' })
  async updateTeam(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<ITeamResponse> {
    return this.teamService.update(actingUserIdFrom(request.headers), id, dto);
  }

  @Patch('teams/:id/hierarchy')
  @ApiOperation({ summary: 'Replace the team hierarchy (org-chart)' })
  async updateHierarchy(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Param('id') id: string,
    @Body() dto: UpdateHierarchyDto,
  ): Promise<ITeamResponse> {
    return this.teamService.updateHierarchy(actingUserIdFrom(request.headers), id, dto);
  }

  @Delete('teams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an owned team and its shares' })
  async deleteTeam(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Param('id') id: string,
  ): Promise<void> {
    await this.teamService.delete(actingUserIdFrom(request.headers), id);
  }
}

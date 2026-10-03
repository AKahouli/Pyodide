import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import {
  AssistantCloneModelDto,
  AssistantCreateModelDto,
  AssistantListQueryDto,
  AssistantMapDocumentsDto,
  AssistantMapSpreadsheetDto,
  AssistantModelChangesDto,
  AssistantProfileDto,
  AssistantRecordsQueryDto,
  AssistantSuggestSourcesDto,
} from '../dto/semantic-model-assistant.dto';
import { AssistantDescribeDataQueryDto, AssistantFindRecordsDto, AssistantQueryRecordsDto, AssistantRelatedRecordsDto } from '../dto/semantic-graph-search.dto';
import { SemanticAssistantActorGuard, SemanticAssistantModelGuard, assistantActorFrom } from '../guards/semantic-assistant-actor.guard';
import { SemanticModelAssistantService } from '../services/semantic-model-assistant.service';

type ActorRequest = { headers: Record<string, string | string[] | undefined> };

const READ = [Permissions.SEMANTIC_MODELS_READ, Permissions.SEMANTIC_MODELS_ALL];
const CREATE = [Permissions.SEMANTIC_MODELS_CREATE, Permissions.SEMANTIC_MODELS_ALL];
const UPDATE = [Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL];
const DELETE = [Permissions.SEMANTIC_MODELS_DELETE, Permissions.SEMANTIC_MODELS_ALL];
const PUBLISH = [Permissions.SEMANTIC_MODELS_PUBLISH, Permissions.SEMANTIC_MODELS_ALL];

/**
 * Trusted service-to-service surface for the semantic model MCP server (mcp-semantic-model). Authenticated
 * with X-Internal-Token plus the identity of the person the agent acts for; that person's permissions and
 * model roles apply to every call, through the same services as the editor. A model can be named by its id
 * or by its exact name.
 */
@ApiTags('Semantic Model Assistant Internal')
@Public()
@Controller('internal/semantic-model-assistant')
@UseGuards(InternalServiceGuard, SemanticAssistantActorGuard, PermissionsGuard, SemanticAssistantModelGuard)
export class SemanticModelAssistantInternalController {
  constructor(private readonly assistant: SemanticModelAssistantService) {}

  @Get('models')
  @RequirePermissions(READ, 'any')
  listModels(@Req() request: ActorRequest, @Query() query: AssistantListQueryDto) {
    return this.assistant.listModels(assistantActorFrom(request.headers).userId, query.search);
  }

  @Post('models')
  @RequirePermissions(CREATE, 'any')
  createModel(@Req() request: ActorRequest, @Body() dto: AssistantCreateModelDto) {
    return this.assistant.createModel(assistantActorFrom(request.headers), dto.name, dto.description);
  }

  /** Copy a model: structure always, sources/data/shares as asked. */
  @Post('models/:modelId/clone')
  @RequirePermissions(CREATE, 'any')
  cloneModel(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantCloneModelDto) {
    return this.assistant.cloneModel(assistantActorFrom(request.headers), modelId, dto);
  }

  /** Delete a model and all its data for good; the exact model name must be repeated. */
  @Delete('models/:modelId')
  @RequirePermissions(DELETE, 'any')
  deleteModel(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Query('confirmName') confirmName: string) {
    return this.assistant.deleteModel(assistantActorFrom(request.headers).userId, modelId, confirmName);
  }

  @Get('models/:modelId')
  @RequirePermissions(READ, 'any')
  describeModel(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.describeModel(assistantActorFrom(request.headers).userId, modelId);
  }

  @Get('models/:modelId/check')
  @RequirePermissions(READ, 'any')
  checkModel(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.checkModel(assistantActorFrom(request.headers).userId, modelId);
  }

  @Post('models/:modelId/changes')
  @ApiOperation({ summary: 'Add, change and remove concepts, fields, key fields and relationships in one step' })
  @RequirePermissions(UPDATE, 'any')
  applyChanges(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantModelChangesDto) {
    const { dryRun, ...changes } = dto;
    return this.assistant.applyChanges(assistantActorFrom(request.headers), modelId, changes, Boolean(dryRun));
  }

  @Get('models/:modelId/changes')
  @RequirePermissions(READ, 'any')
  listChanges(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.listChanges(assistantActorFrom(request.headers).userId, modelId);
  }

  @Post('models/:modelId/changes/undo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE, 'any')
  undoLatest(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.undoChange(assistantActorFrom(request.headers), modelId);
  }

  @Post('models/:modelId/changes/:changeId/undo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE, 'any')
  undo(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Param('changeId') changeId: string) {
    return this.assistant.undoChange(assistantActorFrom(request.headers), modelId, changeId);
  }

  @Get('workspaces')
  @RequirePermissions(READ, 'any')
  listWorkspaces(@Req() request: ActorRequest, @Query() query: AssistantListQueryDto) {
    return this.assistant.listWorkspaces(assistantActorFrom(request.headers).userId, query.search);
  }

  @Get('workspaces/:workspaceId/files')
  @RequirePermissions(READ, 'any')
  listFiles(@Req() request: ActorRequest, @Param('workspaceId') workspaceId: string, @Query() query: AssistantListQueryDto) {
    return this.assistant.listFiles(assistantActorFrom(request.headers).userId, workspaceId, query);
  }

  @Post('models/:modelId/sources/profile')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE, 'any')
  profile(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantProfileDto) {
    return this.assistant.profileSpreadsheet(assistantActorFrom(request.headers), modelId, dto.workspaceId, dto.documentId, dto.sheetName);
  }

  @Post('models/:modelId/sources/spreadsheet')
  @RequirePermissions(UPDATE, 'any')
  mapSpreadsheet(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantMapSpreadsheetDto) {
    return this.assistant.mapSpreadsheet(assistantActorFrom(request.headers), modelId, dto);
  }

  @Post('models/:modelId/sources/documents')
  @RequirePermissions(UPDATE, 'any')
  mapDocuments(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantMapDocumentsDto) {
    return this.assistant.mapDocuments(assistantActorFrom(request.headers), modelId, dto);
  }

  @Post('models/:modelId/source-suggestions')
  @ApiOperation({ summary: 'Suggest sources for concepts; nothing is connected until a person picks one' })
  @RequirePermissions(UPDATE, 'any')
  suggestSources(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantSuggestSourcesDto) {
    return this.assistant.suggestSources(assistantActorFrom(request.headers), modelId, dto.suggestions);
  }

  @Get('models/:modelId/source-suggestions')
  @RequirePermissions(READ, 'any')
  listSuggestions(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.listSuggestions(assistantActorFrom(request.headers).userId, modelId);
  }

  @Delete('models/:modelId/sources/:sourceId')
  @RequirePermissions(UPDATE, 'any')
  removeSource(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Param('sourceId') sourceId: string) {
    return this.assistant.removeSource(assistantActorFrom(request.headers), modelId, sourceId);
  }

  @Post('models/:modelId/runs')
  @RequirePermissions(UPDATE, 'any')
  runUpdate(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.runUpdate(assistantActorFrom(request.headers).userId, modelId);
  }

  @Get('models/:modelId/runs/active')
  @RequirePermissions(READ, 'any')
  activeRun(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.runStatus(assistantActorFrom(request.headers).userId, modelId);
  }

  @Get('models/:modelId/runs/:jobId')
  @RequirePermissions(READ, 'any')
  runStatus(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Param('jobId') jobId: string) {
    return this.assistant.runStatus(assistantActorFrom(request.headers).userId, modelId, jobId);
  }

  @Post('models/:modelId/runs/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop the running data update; the data in use stays as it was' })
  @RequirePermissions(UPDATE, 'any')
  stopActiveRun(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.stopRun(assistantActorFrom(request.headers).userId, modelId);
  }

  @Post('models/:modelId/runs/:jobId/stop')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE, 'any')
  stopRun(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Param('jobId') jobId: string) {
    return this.assistant.stopRun(assistantActorFrom(request.headers).userId, modelId, jobId);
  }

  @Get('models/:modelId/concepts/:concept/records')
  @RequirePermissions(READ, 'any')
  searchRecords(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Param('concept') concept: string, @Query() query: AssistantRecordsQueryDto) {
    return this.assistant.searchRecords(assistantActorFrom(request.headers).userId, modelId, concept, query.q, query.limit);
  }

  @Post('models/:modelId/graph-search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find records of the model by key, words and meaning (published data unless data=draft)' })
  @RequirePermissions(READ, 'any')
  findRecords(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantFindRecordsDto) {
    return this.assistant.findRecords(assistantActorFrom(request.headers).userId, modelId, dto);
  }

  @Post('models/:modelId/graph-expand')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow the real links of some records, one or two steps away' })
  @RequirePermissions(READ, 'any')
  relatedRecords(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantRelatedRecordsDto) {
    return this.assistant.relatedRecords(assistantActorFrom(request.headers).userId, modelId, dto);
  }

  @Get('models/:modelId/data-description')
  @ApiOperation({ summary: 'Concepts, fields with types, relationships and record counts of the published (or draft) data' })
  @RequirePermissions(READ, 'any')
  describeData(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Query() query: AssistantDescribeDataQueryDto) {
    return this.assistant.describeData(assistantActorFrom(request.headers).userId, modelId, query.data ?? 'published');
  }

  @Post('models/:modelId/records-query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Filter, count, group and list the records of one concept (published data unless data=draft)' })
  @RequirePermissions(READ, 'any')
  queryRecords(@Req() request: ActorRequest, @Param('modelId') modelId: string, @Body() dto: AssistantQueryRecordsDto) {
    return this.assistant.queryRecords(assistantActorFrom(request.headers).userId, modelId, dto);
  }

  @Post('models/:modelId/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PUBLISH, 'any')
  publish(@Req() request: ActorRequest, @Param('modelId') modelId: string) {
    return this.assistant.publish(assistantActorFrom(request.headers).userId, modelId);
  }
}

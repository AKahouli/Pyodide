import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { RateLimit } from '@modules/rate-limiter';
import {
  CloneSemanticModelDto,
  ConnectWorkspaceDto,
  CreateBindingDto,
  CreateSemanticModelDto,
  GraphOperationsDto,
  ExpectedModelRevisionDto,
  PublishSemanticModelDto,
  SemanticModelQueryDto,
  SemanticRecordQueryDto,
  UpdateBindingDto,
  UpdateSemanticModelDto,
  CreateSourceMappingDto,
  BulkDocumentSourceMappingDto,
  WorkspaceSourceMappingDto,
  ConceptRecordsQueryDto,
  SourceAssetProfileQueryDto,
  SaveCanvasPositionsDto,
  SourceMappingPreviewDto,
  DataPreviewDto,
  SaveRelationResolutionRuleDto,
  SaveIdentityRuleDto,
  SaveSourceResolutionPolicyDto,
  ListReviewItemsQueryDto,
  ResolveReviewItemDto,
  RequestPopulationRefreshDto,
  RecordCorrectionDto,
} from '../dto';
import { ShareSemanticModelDto, UpdateSemanticModelShareDto } from '../dto/semantic-model-share.dto';
import { SemanticModelShareService } from '../services/semantic-model-share.service';
import { SemanticGraphCommandService } from '../services/semantic-graph-command.service';
import { SemanticKnowledgeBindingService } from '../services/semantic-knowledge-binding.service';
import { SemanticModelService } from '../services/semantic-model.service';
import { SemanticModelVersionService } from '../services/semantic-model-version.service';
import { SemanticModelWorkspaceService } from '../services/semantic-model-workspace.service';
import { SemanticSourceMappingService } from '../services/semantic-source-mapping.service';
import { SemanticCrossSourceService } from '../services/semantic-cross-source.service';
import { SemanticBusinessTrustService } from '../services/semantic-business-trust.service';
import { SemanticPopulationRefreshService } from '../services/semantic-population-refresh.service';
import { SemanticReviewQueueService } from '../services/semantic-review-queue.service';
import { SemanticModelAssistantService } from '../services/semantic-model-assistant.service';
import { AssistantChangesQueryDto, SourceSuggestionStatusDto } from '../dto/semantic-model-assistant.dto';
import { GraphExpandDto, GraphSearchDto, GraphSearchEnvironmentQueryDto, GraphSearchIndexDto } from '../dto/semantic-graph-search.dto';
import { SemanticGraphSearchService } from '../services/semantic-graph-search.service';

@ApiTags('Semantic Models')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('semantic-models')
export class SemanticModelController {
  constructor(
    private readonly models: SemanticModelService,
    private readonly graph: SemanticGraphCommandService,
    private readonly workspaces: SemanticModelWorkspaceService,
    private readonly bindings: SemanticKnowledgeBindingService,
    private readonly versions: SemanticModelVersionService,
    private readonly shares: SemanticModelShareService,
    private readonly sourceMappings: SemanticSourceMappingService,
    private readonly crossSource: SemanticCrossSourceService,
    private readonly businessTrust: SemanticBusinessTrustService,
    private readonly populationRefresh: SemanticPopulationRefreshService,
    private readonly reviewQueue: SemanticReviewQueueService,
    private readonly assistant: SemanticModelAssistantService,
    private readonly graphSearch: SemanticGraphSearchService,
  ) {}

  @Get()
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  list(@CurrentUser() user: AuthUser, @Query() query: SemanticModelQueryDto) {
    return this.models.list(user._id.toString(),query);
  }

  @Post()
  @RequirePermissions([Permissions.SEMANTIC_MODELS_CREATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  create(@CurrentUser() user: AuthUser,@Body() dto: CreateSemanticModelDto) {
    return this.models.create(user._id.toString(),dto);
  }

  @Get(':modelId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  get(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.models.get(user._id.toString(),modelId);
  }

  @Patch(':modelId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  update(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: UpdateSemanticModelDto) {
    return this.models.update(user._id.toString(),modelId,dto);
  }

  @Delete(':modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_DELETE,Permissions.SEMANTIC_MODELS_ALL],'any')
  archive(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: ExpectedModelRevisionDto) {
    return this.models.archive(user._id.toString(),modelId,dto.expectedRevision);
  }

  @Post(':modelId/clone')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_CREATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  clone(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: CloneSemanticModelDto) {
    return this.models.clone(user._id.toString(),modelId,dto.name);
  }

  @Get(':modelId/overview')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  overview(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.models.overview(user._id.toString(),modelId);
  }

  @Get(':modelId/graph')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getGraph(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Query('layer') layer?: string) {
    return this.graph.getGraph(user._id.toString(),modelId,layer);
  }

  @Post(':modelId/graph/operations')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  apply(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: GraphOperationsDto) {
    return this.graph.apply(user._id.toString(),modelId,dto);
  }

  // Validation is read-only; population builds run on the semantic runtime.
  @Post(':modelId/graph/validate')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  async validate(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.graph.validate(user._id.toString(),modelId);
  }

  @Get(':modelId/age-graph')
  @ApiOperation({ summary: 'Read the runtime-built graph bound to a semantic model' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getAgeGraph(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Query('dataRevisionId') dataRevisionId?: string) {
    return this.populationRefresh.boundGraph(user._id.toString(), modelId, dataRevisionId);
  }

  @Post(':modelId/graph/impact')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  impact(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: GraphOperationsDto) {
    return this.graph.impact(user._id.toString(),modelId,dto);
  }

  @Get(':modelId/records')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  records(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Query() query: SemanticRecordQueryDto) {
    return this.graph.listRecords(user._id.toString(),modelId,query);
  }

  @Post(':modelId/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find records in the model data by key, words and meaning' })
  @RateLimit({ limit: 60, windowMs: 60_000, keyPrefix: 'semantic-model:graph-search' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  search(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: GraphSearchDto) {
    return this.graphSearch.search(user._id.toString(),modelId,dto);
  }

  @Post(':modelId/search/expand')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow the real links of some records, one or two steps away' })
  @RateLimit({ limit: 60, windowMs: 60_000, keyPrefix: 'semantic-model:graph-expand' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  expandSearch(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: GraphExpandDto) {
    return this.graphSearch.expand(user._id.toString(),modelId,dto);
  }

  @Get(':modelId/search-index')
  @ApiOperation({ summary: 'State of the search index of the data in use' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  searchIndex(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Query() query: GraphSearchEnvironmentQueryDto) {
    return this.graphSearch.indexStatus(user._id.toString(),modelId,query.environment);
  }

  @Post(':modelId/search-index')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Build the search index of the data in use, in the background' })
  @RateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'semantic-model:graph-search-index' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  ensureSearchIndex(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: GraphSearchIndexDto) {
    return this.graphSearch.ensureIndex(user._id.toString(),modelId,dto.environment);
  }

  @Get(':modelId/workspaces')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listWorkspaces(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.workspaces.list(user._id.toString(),modelId);
  }

  @Post(':modelId/workspaces')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  connectWorkspace(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: ConnectWorkspaceDto) {
    return this.workspaces.connect(user._id.toString(),modelId,dto);
  }

  @Get(':modelId/workspaces/:workspaceId/disconnect-impact')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  disconnectImpact(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('workspaceId') workspaceId: string) {
    return this.workspaces.disconnectImpact(user._id.toString(),modelId,workspaceId);
  }

  @Delete(':modelId/workspaces/:workspaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  disconnectWorkspace(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('workspaceId') workspaceId: string,@Body() dto: ExpectedModelRevisionDto) {
    return this.workspaces.disconnect(user._id.toString(),modelId,workspaceId,dto.expectedRevision);
  }

  @Get(':modelId/bindings')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listBindings(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.bindings.list(user._id.toString(),modelId);
  }

  @Post(':modelId/bindings')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  createBinding(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: CreateBindingDto) {
    return this.bindings.create(user._id.toString(),modelId,dto);
  }

  @Patch(':modelId/bindings/:bindingId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  updateBinding(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('bindingId') bindingId: string,@Body() dto: UpdateBindingDto) {
    return this.bindings.update(user._id.toString(),modelId,bindingId,dto);
  }

  @Delete(':modelId/bindings/:bindingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  deleteBinding(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('bindingId') bindingId: string,@Body() dto: ExpectedModelRevisionDto) {
    return this.bindings.delete(user._id.toString(),modelId,bindingId,dto.expectedRevision);
  }

  // ── Structured source mappings ─────────────────────────────────────────────

  @Get(':modelId/source-assets')
  @ApiOperation({ summary: 'List mappable files available from the workspaces linked to this model' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listSourceAssets(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.sourceMappings.listAssets(user._id.toString(),modelId);
  }

  @Get(':modelId/source-assets/:documentId/profile')
  @ApiOperation({ summary: 'Profile a structured asset: sheet list, or fields + sample rows for one sheet' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  profileSourceAsset(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('documentId') documentId: string,@Query() query: SourceAssetProfileQueryDto) {
    return this.sourceMappings.profileAsset(user._id.toString(),modelId,query.workspaceId,documentId,query);
  }

  @Post(':modelId/source-assets/:documentId/profile')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request or reuse a durable structured-source analysis job' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  requestSourceAssetProfile(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('documentId') documentId: string,@Query() query: SourceAssetProfileQueryDto) {
    return this.sourceMappings.requestProfile(user._id.toString(),modelId,query.workspaceId,documentId,query);
  }

  @Get(':modelId/source-assets/jobs/:jobId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  sourceAssetJob(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('jobId') jobId: string) {
    return this.sourceMappings.discoveryJob(user._id.toString(),modelId,jobId);
  }

  @Get(':modelId/canvas-positions')
  @ApiOperation({ summary: 'Where the source and typed-record boxes sit on the model canvas' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listCanvasPositions(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.sourceMappings.listCanvasPositions(user._id.toString(),modelId);
  }

  @Put(':modelId/canvas-positions')
  @ApiOperation({ summary: 'Move source and typed-record boxes on the model canvas' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  saveCanvasPositions(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: SaveCanvasPositionsDto) {
    return this.sourceMappings.saveCanvasPositions(user._id.toString(),modelId,dto.positions);
  }

  @Get(':modelId/source-mappings')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listSourceMappings(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.sourceMappings.list(user._id.toString(),modelId);
  }

  @Post(':modelId/source-mappings')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  createSourceMapping(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: CreateSourceMappingDto) {
    return this.sourceMappings.create(user._id.toString(),modelId,dto);
  }

  @Post(':modelId/source-mappings/workspace')
  @ApiOperation({ summary: 'Map every readable file of a workspace, or of one of its folders, with one document mapping' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  createWorkspaceSourceMapping(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: WorkspaceSourceMappingDto) {
    return this.sourceMappings.createWorkspace(user._id.toString(),modelId,dto);
  }

  @Get(':modelId/concepts/:conceptId/records')
  @ApiOperation({ summary: 'Browse one concept\'s records in the data in use, searchable and paged' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listConceptRecords(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('conceptId') conceptId: string,@Query() query: ConceptRecordsQueryDto) {
    return this.populationRefresh.conceptRecords(user._id.toString(),modelId,conceptId,query);
  }

  @Post(':modelId/source-mappings/bulk-documents')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  createBulkDocumentSourceMappings(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: BulkDocumentSourceMappingDto) {
    return this.sourceMappings.createBulkDocuments(user._id.toString(),modelId,dto);
  }

  @Post(':modelId/source-mappings/preview')
  @ApiOperation({ summary: 'Resolve entities from a spreadsheet or document using a draft field mapping' })
  @RateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'semantic-model:source-preview' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  previewSourceMapping(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: SourceMappingPreviewDto) {
    return this.sourceMappings.preview(user._id.toString(),modelId,dto);
  }

  @Delete(':modelId/source-mappings/:mappingId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  deleteSourceMapping(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('mappingId') mappingId: string,@Body() dto: ExpectedModelRevisionDto) {
    return this.sourceMappings.delete(user._id.toString(),modelId,mappingId,dto.expectedRevision);
  }

  @Post(':modelId/population/refresh')
  @ApiOperation({ summary: 'Prepare or refresh population for the whole model or one mapping' })
  @RateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'semantic-model:population-refresh' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  requestPopulationRefresh(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: RequestPopulationRefreshDto) {
    return this.populationRefresh.requestRefresh(user._id.toString(),modelId,dto);
  }

  @Get(':modelId/population/freshness')
  @ApiOperation({ summary: 'Whether the records in use were built from the model as it is now' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  populationFreshness(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.populationRefresh.freshness(user._id.toString(),modelId);
  }

  @Get(':modelId/population/jobs/:jobId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  populationJob(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('jobId') jobId: string) {
    return this.populationRefresh.getJob(user._id.toString(), modelId, jobId);
  }

  @Get(':modelId/population/active')
  @ApiOperation({ summary: 'The data update still running for this model, if any' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  activePopulationJob(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.populationRefresh.activeJob(user._id.toString(), modelId).then((job) => ({ job }));
  }

  @Post(':modelId/population/jobs/:jobId/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop a data update; the data in use stays as it was' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  stopPopulationJob(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('jobId') jobId: string) {
    return this.populationRefresh.stopJob(user._id.toString(), modelId, jobId);
  }

  @Get(':modelId/relation-resolution-rules')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listRelationResolutionRules(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.crossSource.listRules(user._id.toString(), modelId);
  }

  @Post(':modelId/relation-resolution-rules')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  saveRelationResolutionRule(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: SaveRelationResolutionRuleDto) {
    return this.crossSource.saveRule(user._id.toString(), modelId, dto);
  }

  @Post(':modelId/relation-resolution-rules/:ruleId/preview')
  @RateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'semantic-model:relation-preview' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  previewRelationResolutionRule(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('ruleId') ruleId: string,@Body() dto: DataPreviewDto) {
    return this.crossSource.previewRule(user._id.toString(), modelId, ruleId, dto.limit);
  }

  @Get(':modelId/identity-rules')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listIdentityRules(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.crossSource.listIdentityRules(user._id.toString(), modelId);
  }

  @Put(':modelId/identity-rules/:conceptId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  saveIdentityRule(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('conceptId') conceptId: string,@Body() dto: SaveIdentityRuleDto) {
    return this.crossSource.saveIdentityRule(user._id.toString(), modelId, conceptId, dto);
  }

  @Get(':modelId/source-resolution-policies')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listSourceResolutionPolicies(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.crossSource.listPolicies(user._id.toString(), modelId);
  }

  @Put(':modelId/source-resolution-policies/:conceptId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  saveSourceResolutionPolicy(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('conceptId') conceptId: string,@Body() dto: SaveSourceResolutionPolicyDto) {
    return this.crossSource.savePolicy(user._id.toString(), modelId, conceptId, dto);
  }

  @Post(':modelId/data-preview')
  @RateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'semantic-model:data-preview' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  dataPreview(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: DataPreviewDto) {
    return this.populationRefresh.boundRecords(user._id.toString(), modelId, dto.limit, dto.conceptId, dto.dataRevisionId);
  }

  @Get(':modelId/corrections')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listCorrections(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.populationRefresh.listCorrections(user._id.toString(), modelId);
  }

  @Post(':modelId/corrections')
  @ApiOperation({ summary: 'Fix a value, hide a record or link, or add a missing link; kept across rebuilds' })
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'semantic-model:corrections' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  recordCorrection(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: RecordCorrectionDto) {
    return this.populationRefresh.recordCorrection(user._id.toString(), modelId, dto);
  }

  @Post(':modelId/corrections/:sequence/undo')
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'semantic-model:corrections' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  undoCorrection(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('sequence', ParseIntPipe) sequence: number) {
    return this.populationRefresh.undoCorrection(user._id.toString(), modelId, sequence);
  }

  @Post(':modelId/mapping-health')
  @RateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'semantic-model:mapping-health' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  mappingHealth(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.businessTrust.mappingHealth(user._id.toString(), modelId);
  }

  @Get(':modelId/readiness')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  readiness(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.businessTrust.readiness(user._id.toString(), modelId);
  }

  @Get(':modelId/review-queue')
  @ApiOperation({ summary: 'Everything that needs a person, grouped and prioritised, each with the action that resolves it' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  reviewQueueList(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.reviewQueue.reviewQueue(user._id.toString(), modelId);
  }

  @Get(':modelId/review-items')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  reviewItems(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Query() query: ListReviewItemsQueryDto) {
    return this.businessTrust.reviewItems(user._id.toString(), modelId, query);
  }

  @Post(':modelId/review-items/:reviewItemId/resolve')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  resolveReviewItem(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('reviewItemId') reviewItemId: string,@Body() dto: ResolveReviewItemDto) {
    return this.businessTrust.resolveReviewItem(user._id.toString(), modelId, reviewItemId, dto);
  }

  @Get(':modelId/versions')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  versionsList(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.versions.list(user._id.toString(),modelId);
  }

  @Post(':modelId/versions/publish')
  @ApiOperation({ summary: 'Publish the current draft and open a new editable draft' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_PUBLISH,Permissions.SEMANTIC_MODELS_ALL],'any')
  publish(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: PublishSemanticModelDto) {
    return this.versions.publish(user._id.toString(),modelId,dto.expectedRevision,dto.expectedGraphRevision);
  }

  @Get(':modelId/versions/compare')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  compare(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Query('left') left: string,@Query('right') right: string) {
    return this.versions.compare(user._id.toString(),modelId,left,right);
  }

  @Post(':modelId/versions/:versionId/restore')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  restore(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('versionId') versionId: string,@Body() dto: PublishSemanticModelDto) {
    return this.versions.restore(user._id.toString(),modelId,versionId,dto.expectedRevision,dto.expectedGraphRevision);
  }

  // ── Assistant changes ─────────────────────────────────────────────────────

  @Get(':modelId/assistant/changes')
  @ApiOperation({ summary: 'Recent changes an assistant made to the model, with the draft graph revision' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  assistantChanges(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Query() query: AssistantChangesQueryDto) {
    return this.assistant.listChanges(user._id.toString(),modelId,query.since);
  }

  @Post(':modelId/assistant/changes/:changeId/undo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  undoAssistantChange(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('changeId') changeId: string) {
    return this.assistant.undoChange({ userId: user._id.toString() },modelId,changeId);
  }

  @Post(':modelId/assistant/changes/:changeId/redo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  redoAssistantChange(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('changeId') changeId: string) {
    return this.assistant.redoChange({ userId: user._id.toString() },modelId,changeId);
  }

  @Get(':modelId/source-suggestions')
  @ApiOperation({ summary: 'Sources an assistant suggested for the concepts, and whether each was used or skipped' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  sourceSuggestions(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.assistant.listSuggestions(user._id.toString(),modelId);
  }

  @Get(':modelId/source-files')
  @ApiOperation({ summary: 'Files matching a name across the workspaces the person can open, to choose a source' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  async searchSourceFiles(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Query('search') search = '',@Query('page') page?: string) {
    await this.models.get(user._id.toString(),modelId);
    return this.assistant.searchSourceFiles(user._id.toString(),search,Math.max(1,Number(page)||1));
  }

  @Put(':modelId/source-suggestions/:conceptKey/status')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  setSourceSuggestionStatus(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('conceptKey') conceptKey: string,@Body() dto: SourceSuggestionStatusDto) {
    return this.assistant.setSuggestionStatus(user._id.toString(),modelId,conceptKey,dto.status);
  }

  // ── Sharing ────────────────────────────────────────────────────────────────

  @Get(':modelId/shares')
  @ApiOperation({ summary: 'List all members with access to a semantic model (owner-only management, all members can view)' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listShares(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string) {
    return this.shares.list(user._id.toString(),modelId);
  }

  @Post(':modelId/shares')
  @ApiOperation({ summary: 'Share a semantic model with one or more users by email' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  share(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Body() dto: ShareSemanticModelDto) {
    return this.shares.share(user._id.toString(),modelId,dto);
  }

  @Patch(':modelId/shares/:targetUserId')
  @ApiOperation({ summary: 'Update the role of a shared member' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  updateShare(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('targetUserId') targetUserId: string,@Body() dto: UpdateSemanticModelShareDto) {
    return this.shares.updateRole(user._id.toString(),modelId,targetUserId,dto);
  }

  @Delete(':modelId/shares/:targetUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke access for a shared member' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  revokeShare(@CurrentUser() user: AuthUser,@Param('modelId') modelId: string,@Param('targetUserId') targetUserId: string) {
    return this.shares.revoke(user._id.toString(),modelId,targetUserId);
  }
}

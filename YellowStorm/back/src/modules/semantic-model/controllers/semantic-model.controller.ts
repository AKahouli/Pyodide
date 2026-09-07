import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import {
  CloneSemanticModelDto,
  ConnectWorkspaceDto,
  CreateBindingDto,
  CreateSemanticModelDto,
  GenerateSemanticModelOntologyDto,
  GraphOperationsDto,
  AgeGraphOperationsDto,
  ExpectedModelRevisionDto,
  PublishSemanticModelDto,
  SemanticModelQueryDto,
  SemanticRecordQueryDto,
  StartSemanticModelBuildDto,
  UpdateBindingDto,
  UpdateSemanticModelDto,
} from '../dto';
import { ShareSemanticModelDto, UpdateSemanticModelShareDto } from '../dto/semantic-model-share.dto';
import { SemanticModelShareService } from '../services/semantic-model-share.service';
import { SemanticGraphCommandService } from '../services/semantic-graph-command.service';
import { SemanticKnowledgeBindingService } from '../services/semantic-knowledge-binding.service';
import { SemanticModelService } from '../services/semantic-model.service';
import { SemanticModelVersionService } from '../services/semantic-model-version.service';
import { SemanticModelWorkspaceService } from '../services/semantic-model-workspace.service';
import { SemanticModelOntologyGenerationService } from '../services/semantic-model-ontology-generation.service';
import { SemanticModelCorpusPreparationService } from '../services/semantic-model-corpus-preparation.service';
import { SemanticModelEvidenceSearchService } from '../services/semantic-model-evidence-search.service';
import { SemanticModelMappingProposalService } from '../services/semantic-model-mapping-proposal.service';
import { SemanticModelBuildOrchestratorService } from '../services/semantic-model-build-orchestrator.service';

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
    private readonly ontologyGeneration: SemanticModelOntologyGenerationService,
    private readonly corpusPreparation: SemanticModelCorpusPreparationService,
    private readonly evidenceSearch: SemanticModelEvidenceSearchService,
    private readonly mappingProposals: SemanticModelMappingProposalService,
    private readonly builds: SemanticModelBuildOrchestratorService,
    private readonly shares: SemanticModelShareService,
  ) {}

  @Get()
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  list(@CurrentUser() user: UserDocument, @Query() query: SemanticModelQueryDto) {
    return this.models.list(user._id.toString(),query);
  }

  @Post()
  @RequirePermissions([Permissions.SEMANTIC_MODELS_CREATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  create(@CurrentUser() user: UserDocument,@Body() dto: CreateSemanticModelDto) {
    return this.models.create(user._id.toString(),dto);
  }

  @Get(':modelId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  get(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.models.get(user._id.toString(),modelId);
  }

  @Patch(':modelId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  update(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: UpdateSemanticModelDto) {
    return this.models.update(user._id.toString(),modelId,dto);
  }

  @Delete(':modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_DELETE,Permissions.SEMANTIC_MODELS_ALL],'any')
  archive(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: ExpectedModelRevisionDto) {
    return this.models.archive(user._id.toString(),modelId,dto.expectedRevision);
  }

  @Post(':modelId/clone')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_CREATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  clone(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: CloneSemanticModelDto) {
    return this.models.clone(user._id.toString(),modelId,dto.name);
  }

  @Get(':modelId/overview')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  overview(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.models.overview(user._id.toString(),modelId);
  }

  @Get(':modelId/graph')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getGraph(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Query('layer') layer?: string) {
    return this.graph.getGraph(user._id.toString(),modelId,layer);
  }

  @Post(':modelId/graph/operations')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  apply(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: GraphOperationsDto) {
    return this.graph.apply(user._id.toString(),modelId,dto);
  }

  @Post(':modelId/graph/validate')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  validate(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.graph.validate(user._id.toString(),modelId);
  }

  @Post(':modelId/ontology/generate')
  @ApiOperation({ summary: 'Generate local Semantica ontology artifacts from the current designer canvas' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  generateOntology(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: GenerateSemanticModelOntologyDto) {
    return this.ontologyGeneration.generate(user._id.toString(), modelId, dto);
  }

  @Get(':modelId/corpus')
  @ApiOperation({ summary: 'Prepare the indexed document corpus selected by Semantic Model knowledge bindings' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getPreparedCorpus(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.corpusPreparation.prepare(user._id.toString(), modelId);
  }

  @Post(':modelId/evidence/search')
  @ApiOperation({ summary: 'Use the configured Logical Search MCP agent for Semantic Model evidence discovery' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  searchEvidence(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.evidenceSearch.search(user._id.toString(), modelId);
  }

  @Post(':modelId/mapping/proposals')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start an async mapping proposal job and return a jobId for polling' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  startMappingProposalJob(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.mappingProposals.startAsync(user._id.toString(), modelId);
  }

  @Get(':modelId/mapping/proposals/jobs')
  @ApiOperation({ summary: 'List all mapping proposal runs for a model (most recent first)' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listMappingProposalJobs(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.mappingProposals.listJobs(user._id.toString(), modelId);
  }

  @Get(':modelId/mapping/proposals/jobs/:jobId')
  @ApiOperation({ summary: 'Poll the status and result of an async mapping proposal job' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getMappingProposalJob(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('jobId') jobId: string) {
    return this.mappingProposals.getJob(user._id.toString(), modelId, jobId);
  }

  @Post(':modelId/mapping/jobs/:jobId/apply')
  @ApiOperation({ summary: 'Apply a completed mapping plan — persists nodes and edges as Business Records' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  applyMappingPlan(
    @CurrentUser() user: UserDocument,
    @Param('modelId') modelId: string,
    @Param('jobId') jobId: string,
    @Query('mode') mode?: 'replace' | 'incremental',
  ) {
    return this.mappingProposals.applyMappingPlan(user._id.toString(), modelId, jobId, mode ?? 'incremental');
  }

  @Get(':modelId/age-graph')
  @ApiOperation({ summary: 'Read the AGE graph for a semantic model — returns all vertices and edges stored in Apache AGE' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getAgeGraph(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.mappingProposals.getAgeGraph(user._id.toString(), modelId);
  }

  @Post(':modelId/age-graph/rebuild')
  @ApiOperation({ summary: 'Rebuild the AGE projection from the saved semantic graph records' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  rebuildAgeGraph(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.mappingProposals.rebuildAgeGraph(user._id.toString(), modelId);
  }

  @Post(':modelId/age-graph/operations')
  @ApiOperation({ summary: 'Apply safe add/delete node and relationship operations directly to the Apache AGE graph' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  applyAgeGraphOperations(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: AgeGraphOperationsDto) {
    return this.mappingProposals.applyAgeGraphOperations(user._id.toString(), modelId, dto);
  }

  @Post(':modelId/builds')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start an async build (ontology + mapping + apply). Returns a buildId immediately for polling.' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  startBuild(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: StartSemanticModelBuildDto) {
    return this.builds.startAsync(user._id.toString(), modelId, {
      businessRequirements: dto.businessRequirements ?? [],
      applyMode: dto.applyMode ?? 'replace',
      manualInstances: dto.manualInstances ?? [],
    });
  }

  @Get(':modelId/builds/latest')
  @ApiOperation({ summary: 'Get the most recent build for this model (any status). Used by the UI banner to reattach polling after reload.' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getLatestBuild(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.builds.getLatestBuild(user._id.toString(), modelId);
  }

  @Get(':modelId/builds/:buildId')
  @ApiOperation({ summary: 'Poll the status and per-step progress of a build job.' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getBuild(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('buildId') buildId: string) {
    return this.builds.getBuild(user._id.toString(), modelId, buildId);
  }


  @Post(':modelId/graph/impact')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  impact(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: GraphOperationsDto) {
    return this.graph.impact(user._id.toString(),modelId,dto);
  }

  @Get(':modelId/records')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  records(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Query() query: SemanticRecordQueryDto) {
    return this.graph.listRecords(user._id.toString(),modelId,query);
  }

  @Get(':modelId/workspaces')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listWorkspaces(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.workspaces.list(user._id.toString(),modelId);
  }

  @Post(':modelId/workspaces')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  connectWorkspace(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: ConnectWorkspaceDto) {
    return this.workspaces.connect(user._id.toString(),modelId,dto);
  }

  @Get(':modelId/workspaces/:workspaceId/disconnect-impact')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  disconnectImpact(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('workspaceId') workspaceId: string) {
    return this.workspaces.disconnectImpact(user._id.toString(),modelId,workspaceId);
  }

  @Delete(':modelId/workspaces/:workspaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  disconnectWorkspace(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('workspaceId') workspaceId: string,@Body() dto: ExpectedModelRevisionDto) {
    return this.workspaces.disconnect(user._id.toString(),modelId,workspaceId,dto.expectedRevision);
  }

  @Get(':modelId/bindings')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listBindings(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.bindings.list(user._id.toString(),modelId);
  }

  @Post(':modelId/bindings')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  createBinding(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: CreateBindingDto) {
    return this.bindings.create(user._id.toString(),modelId,dto);
  }

  @Patch(':modelId/bindings/:bindingId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  updateBinding(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('bindingId') bindingId: string,@Body() dto: UpdateBindingDto) {
    return this.bindings.update(user._id.toString(),modelId,bindingId,dto);
  }

  @Delete(':modelId/bindings/:bindingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  deleteBinding(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('bindingId') bindingId: string,@Body() dto: ExpectedModelRevisionDto) {
    return this.bindings.delete(user._id.toString(),modelId,bindingId,dto.expectedRevision);
  }

  @Get(':modelId/versions')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  versionsList(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.versions.list(user._id.toString(),modelId);
  }

  @Post(':modelId/versions/publish')
  @ApiOperation({ summary: 'Publish the current draft and open a new editable draft' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_PUBLISH,Permissions.SEMANTIC_MODELS_ALL],'any')
  publish(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: PublishSemanticModelDto) {
    return this.versions.publish(user._id.toString(),modelId,dto.expectedRevision,dto.expectedGraphRevision);
  }

  @Get(':modelId/versions/compare')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  compare(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Query('left') left: string,@Query('right') right: string) {
    return this.versions.compare(user._id.toString(),modelId,left,right);
  }

  @Post(':modelId/versions/:versionId/restore')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  restore(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('versionId') versionId: string,@Body() dto: PublishSemanticModelDto) {
    return this.versions.restore(user._id.toString(),modelId,versionId,dto.expectedRevision,dto.expectedGraphRevision);
  }

  // ── Sharing ────────────────────────────────────────────────────────────────

  @Get(':modelId/shares')
  @ApiOperation({ summary: 'List all members with access to a semantic model (owner-only management, all members can view)' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  listShares(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string) {
    return this.shares.list(user._id.toString(),modelId);
  }

  @Post(':modelId/shares')
  @ApiOperation({ summary: 'Share a semantic model with one or more users by email' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  share(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Body() dto: ShareSemanticModelDto) {
    return this.shares.share(user._id.toString(),modelId,dto);
  }

  @Patch(':modelId/shares/:targetUserId')
  @ApiOperation({ summary: 'Update the role of a shared member' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  updateShare(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('targetUserId') targetUserId: string,@Body() dto: UpdateSemanticModelShareDto) {
    return this.shares.updateRole(user._id.toString(),modelId,targetUserId,dto);
  }

  @Delete(':modelId/shares/:targetUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke access for a shared member' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  revokeShare(@CurrentUser() user: UserDocument,@Param('modelId') modelId: string,@Param('targetUserId') targetUserId: string) {
    return this.shares.revoke(user._id.toString(),modelId,targetUserId);
  }
}

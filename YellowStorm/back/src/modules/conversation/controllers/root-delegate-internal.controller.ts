import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { InternalServiceGuard } from '../../auth/guards/internal-service.guard';
import { ResolveRootDelegateDto } from '../dto/resolve-root-delegate.dto';
import { SettleRootDelegateDto } from '../dto/settle-root-delegate.dto';
import { RootDelegateDefinitionService } from '../root-work/root-delegate-definition.service';
import { RootTemporaryDefinitionService } from '../root-work/root-temporary-definition.service';
import { ResolveRootTemporaryDto } from '../dto/resolve-root-temporary.dto';
import { RootFanoutProposalDto } from '../dto/root-fanout-proposal.dto';
import { RootFanoutService } from '../root-work/root-fanout.service';
import { RootWorkerPermitDto } from '../dto/root-worker-permit.dto';
import { RootBackgroundAuthorityDto, RootBackgroundEventsDto, RootBackgroundSettlementDto, RootBackgroundPermitDto, RootBackgroundFanoutDto } from '../dto/root-background.dto';
import { RootBackgroundLifecycleService } from '../root-work/root-background-lifecycle.service';
import { RootBackgroundSubmissionService } from '../root-work/root-background-submission.service';
import { RootBackgroundSubmissionDto } from '../dto/root-background-submission.dto';
import { RootBackgroundResultPageDto } from '../dto/root-background.dto';
import { RootJobResultDto } from '../dto/root-work-public.dto';
import { RootConversationReplyService } from '../root-work/root-conversation-reply.service';
import { ConversationArtifactService } from '../services/conversation-artifact.service';
import { InternalConversationAssetDto, PrepareConversationAssetDto, RegisterConversationAssetDto } from '../dto/conversation-asset.dto';
import { GenerateConversationImageDto } from '../dto/generate-conversation-image.dto';
import { RateLimit } from '../../rate-limiter/decorators/rate-limit.decorator';

@ApiTags('Root work internal')
@Public()
@UseGuards(InternalServiceGuard)
@Controller('internal/root-work')
export class RootDelegateInternalController {
  constructor(private readonly definitions: RootDelegateDefinitionService,
    private readonly temporary: RootTemporaryDefinitionService, private readonly fanout: RootFanoutService,
    private readonly background: RootBackgroundLifecycleService, private readonly backgroundSubmission: RootBackgroundSubmissionService,
    private readonly conversationReplies: RootConversationReplyService,
    private readonly artifacts: ConversationArtifactService) {}

  @Post('assets/list')
  @RateLimit({ limit: 60, windowMs: 60_000, keyPrefix: 'conversation-assets' })
  listAssets(@Body() request: InternalConversationAssetDto) {
    return this.artifacts.listAssets(request.conversationId, request.userId, request);
  }

  @Post('assets/inspect')
  inspectAsset(@Body() request: InternalConversationAssetDto) {
    return this.artifacts.inspectAsset(request.conversationId, request.userId, request.ref ?? '');
  }

  @Post('assets/revocation')
  revocationState(@Body() request: InternalConversationAssetDto) {
    return this.artifacts.assetRevocationState(request.conversationId, request.userId);
  }

  @Post('assets/read')
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'conversation-asset-read' })
  readAsset(@Body() request: InternalConversationAssetDto) {
    return this.artifacts.readAsset(request.conversationId, request.userId, request.ref ?? '', request.maxChars);
  }

  @Post('assets/prepare')
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'conversation-asset-prepare' })
  prepareAsset(@Body() request: PrepareConversationAssetDto) {
    return this.artifacts.prepareAsset(request.conversationId, request.userId, request.ref, request.invocationId, request.includeBytes);
  }

  @Post('assets/register')
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'conversation-asset-register' })
  registerAsset(@Body() request: RegisterConversationAssetDto) {
    return this.artifacts.registerAsset(request);
  }

  @Post('images/generate')
  @RateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'conversation-image-generation' })
  async generateImage(@Body() request: GenerateConversationImageDto, @Req() incoming: Request,
    @Res({ passthrough: true }) response: Response) {
    const controller = new AbortController();
    const abort = () => { if (!response.writableEnded) controller.abort(); };
    incoming.once('aborted', abort);
    response.once('close', abort);
    try { return await this.artifacts.generateImage(request, controller.signal); }
    finally { incoming.off('aborted', abort); response.off('close', abort); }
  }

  @Post(':executionId/conversation-replies/:messageId/cancel')
  cancelConversationReply(@Param('executionId') executionId: string, @Param('messageId') messageId: string) {
    return this.conversationReplies.cancel(executionId, messageId);
  }

  @Post(':executionId/background-task')
  submitBackground(@Param('executionId') executionId: string, @Body() request: RootBackgroundSubmissionDto) {
    return this.backgroundSubmission.submit(executionId, request);
  }

  @Post(':executionId/background-fanout')
  submitBackgroundFanout(@Param('executionId') executionId: string, @Body() request: RootBackgroundFanoutDto) {
    return this.backgroundSubmission.submitFanout(executionId, request);
  }

  @Post(':executionId/background-tasks/:childId/status')
  statusBackground(@Param('executionId') executionId: string, @Param('childId') childId: string) {
    return this.backgroundSubmission.status(executionId, childId);
  }

  @Post(':executionId/background-tasks')
  backgroundTasks(@Param('executionId') executionId: string) {
    return this.backgroundSubmission.list(executionId);
  }

  @Post(':executionId/background-tasks/:childId/result')
  backgroundResult(@Param('executionId') executionId: string, @Param('childId') childId: string,
    @Body() request: RootJobResultDto) {
    return this.backgroundSubmission.result(executionId, childId, request.offset);
  }

  @Post(':executionId/background-tasks/:childId/cancel')
  cancelBackgroundTask(@Param('executionId') executionId: string, @Param('childId') childId: string) {
    return this.backgroundSubmission.cancel(executionId, childId);
  }

  @Post(':executionId/background-definition')
  definitionBackground(@Param('executionId') executionId: string, @Body() request: RootBackgroundAuthorityDto) {
    return this.background.definition(executionId, request);
  }

  @Post(':executionId/background-events')
  ingestBackground(@Param('executionId') executionId: string, @Body() request: RootBackgroundEventsDto) {
    return this.background.ingest(executionId, request);
  }

  @Post(':executionId/background-items/:itemId/definition')
  definitionBackgroundItem(@Param('executionId') executionId: string, @Param('itemId') itemId: string,
    @Body() request: RootBackgroundAuthorityDto) {
    return this.background.itemDefinition(executionId, itemId, request);
  }

  @Post(':executionId/background-items/:itemId/permit')
  permitBackgroundItem(@Param('executionId') executionId: string, @Param('itemId') itemId: string,
    @Body() request: RootBackgroundPermitDto) {
    return this.background.itemPermit(executionId, itemId, request);
  }

  @Post(':executionId/background-items/:itemId/lifecycle')
  settleBackgroundItem(@Param('executionId') executionId: string, @Param('itemId') itemId: string,
    @Body() request: RootBackgroundSettlementDto) {
    return this.background.itemSettle(executionId, itemId, request);
  }

  @Post(':executionId/background-items/:itemId/evidence-page')
  stageBackgroundItemEvidence(@Param('executionId') executionId: string, @Param('itemId') itemId: string,
    @Body() request: RootBackgroundSettlementDto) {
    return this.background.stageEvidence(executionId, request, itemId);
  }

  @Post(':executionId/background-evidence-page')
  stageBackgroundEvidence(@Param('executionId') executionId: string, @Body() request: RootBackgroundSettlementDto) {
    return this.background.stageEvidence(executionId, request);
  }

  @Post(':executionId/background-lifecycle')
  settleBackground(@Param('executionId') executionId: string, @Body() request: RootBackgroundSettlementDto) {
    return this.background.settle(executionId, request);
  }

  @Post(':executionId/fanout-manifest')
  @ApiOperation({ summary: 'Reserve a complete immutable foreground fan-out manifest' })
  reserveFanout(@Param('executionId') executionId: string, @Body() request: RootFanoutProposalDto) {
    return this.fanout.reserve(executionId, request);
  }

  @Post(':executionId/children/:childId/permit')
  @ApiOperation({ summary: 'Acquire or release an owned shared ROOT worker slot' })
  permit(@Param('executionId') executionId: string, @Param('childId') childId: string,
    @Body() request: RootWorkerPermitDto) {
    return this.fanout.permit(executionId, childId, request);
  }

  @Post(':executionId/temporary-definition')
  @ApiOperation({ summary: 'Resolve and reserve one root-derived temporary worker' })
  resolveTemporary(@Param('executionId') executionId: string, @Body() request: ResolveRootTemporaryDto) {
    return this.temporary.resolve(executionId, request);
  }

  @Post(':executionId/background-synthesis-results/:producerId')
  readSynthesisResult(@Param('executionId') executionId: string, @Param('producerId') producerId: string,
    @Body() request: RootBackgroundResultPageDto) {
    return this.background.readSynthesisResult(executionId, producerId, request);
  }

  @Post(':executionId/delegate-definition')
  @ApiOperation({ summary: 'Resolve and admit one authorized native delegate call' })
  resolve(@Param('executionId') executionId: string, @Body() request: ResolveRootDelegateDto) {
    return this.definitions.resolve(executionId, request);
  }

  @Post(':executionId/children/:childId/lifecycle')
  @ApiOperation({ summary: 'Persist a selected child lifecycle before root synthesis' })
  settle(@Param('executionId') executionId: string, @Param('childId') childId: string,
    @Body() request: SettleRootDelegateDto) {
    return this.definitions.settle(executionId, childId, request);
  }

  @Post(':executionId/children/:childId/evidence-page')
  stageEvidence(@Param('executionId') executionId: string, @Param('childId') childId: string,
    @Body() request: SettleRootDelegateDto) {
    return this.definitions.stageEvidence(executionId, childId, request);
  }
}

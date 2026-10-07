import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { isObjectId } from '@common/postgres';
import { WorkyInteractionService } from '../services/worky-interaction.service';
import { WorkyPlanDeltaService } from '../services/worky-plan-delta.service';
import { RespondWorkyInteractionDto } from '../dto/respond-worky-interaction.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { NotFoundException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyInteractionRepository } from '../persistence/worky-interaction.repository';
import { WorkyPlanRepository } from '../persistence/worky-plan.repository';
import {
  PreparedWorkyTurn,
  WorkyTurnKickoffService,
} from '../services/worky-turn-kickoff.service';
import { canWriteWorkyStream } from '../worky-stream-access';

export interface RespondInteractionResponse {
  interactionId: string;
  streamId: string;
  status: 'responded' | 'canceled';
  response: string;
  verdict: 'approved' | 'rejected' | null;
  followUpTurnStarted: boolean;
  replanApplied?: { planDeltaId: string; status: 'auto_applied' | 'rejected' };
}

@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/interactions')
export class WorkyInteractionController {
  constructor(
    private readonly interactions: WorkyInteractionService,
    private readonly planDeltaService: WorkyPlanDeltaService,
    private readonly kickoff: WorkyTurnKickoffService,
    private readonly streams: WorkyStreamRepository,
    private readonly interactionRecords: WorkyInteractionRepository,
    private readonly plans: WorkyPlanRepository,
  ) {}

  @Post(':id/respond')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permissions.WORKY_INTERACTION_RESPOND)
  @ApiOperation({
    summary: 'Respond to a pending interaction',
  })
  @ApiParam({ name: 'id', description: 'Interaction id' })
  async respond(
    @CurrentUser() user: AuthUser,
    @Param('id') interactionId: string,
    @Body() dto: RespondWorkyInteractionDto,
  ): Promise<RespondInteractionResponse> {
    if (!isObjectId(interactionId)) {
      throw new NotFoundException(
        ErrorCode.WORKY_INTERACTION_NOT_FOUND,
        'Worky interaction not found.',
      );
    }
    const interaction = await this.interactionRecords.findById(interactionId);
    if (!interaction) {
      throw new NotFoundException(
        ErrorCode.WORKY_INTERACTION_NOT_FOUND,
        'Worky interaction not found.',
      );
    }
    const stream = await this.streams.findById(interaction.streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (!canWriteWorkyStream(stream, user._id.toString())) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky interaction.',
      );
    }
    const preparedTurn: PreparedWorkyTurn | null = dto.cancel
      ? null
      : await this.kickoff.prepare({
          streamId: interaction.streamId,
          userId: user._id.toString(),
          content: dto.content,
          requester: user,
        });
    const result = await this.interactions.respond({
      userId: user._id.toString(),
      interactionId,
      dto,
    });

    // Replan approvals bypass the governance guard (the owner has
    // already approved), so we look up the pending delta and apply it
    // through `applyApproved` (canonical §17.4).
    let replanApplied: RespondInteractionResponse['replanApplied'];
    if (
      interaction.type === 'replan_review' &&
      result.verdict === 'approved'
    ) {
      const planDeltaId = interaction.metadata.planDeltaId;
      if (typeof planDeltaId === 'string' && isObjectId(planDeltaId)) {
        const pending = await this.plans.findDeltaById(planDeltaId);
        if (pending && pending.status === 'pending_approval') {
          const applyResult = await this.planDeltaService.applyApproved({
            planDeltaId,
            approvedBy: user._id.toString(),
          });
          replanApplied = {
            planDeltaId: applyResult.planDeltaId,
            status: applyResult.status === 'auto_applied' ? 'auto_applied' : 'rejected',
          };
        }
      }
    }

    let followUpTurnStarted = false;
    if (result.status === 'responded' && preparedTurn) {
      this.kickoff.dispatch(preparedTurn);
      followUpTurnStarted = true;
    }
    return { ...result, followUpTurnStarted, replanApplied };
  }
}

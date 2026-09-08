import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { WorkyInteractionService } from '../services/worky-interaction.service';
import { WorkyPlanDeltaService } from '../services/worky-plan-delta.service';
import { RespondWorkyInteractionDto } from '../dto/respond-worky-interaction.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { Types } from 'mongoose';
import { NotFoundException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { WorkyInteraction, WorkyInteractionDocument } from '../schemas/worky-interaction.schema';
import { WorkyPlanDelta, WorkyPlanDeltaDocument } from '../schemas/worky-plan-delta.schema';
import {
  PreparedWorkyTurn,
  WorkyTurnKickoffService,
} from '../services/worky-turn-kickoff.service';

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
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyInteraction.name)
    private readonly interactionModel: Model<WorkyInteractionDocument>,
    @InjectModel(WorkyPlanDelta.name)
    private readonly planDeltas: Model<WorkyPlanDeltaDocument>,
  ) {}

  @Post(':id/respond')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permissions.WORKY_INTERACTION_RESPOND)
  @ApiOperation({
    summary: 'Respond to a pending interaction',
  })
  @ApiParam({ name: 'id', description: 'Interaction id' })
  async respond(
    @CurrentUser() user: UserDocument,
    @Param('id') interactionId: string,
    @Body() dto: RespondWorkyInteractionDto,
  ): Promise<RespondInteractionResponse> {
    if (!Types.ObjectId.isValid(interactionId)) {
      throw new NotFoundException(
        ErrorCode.WORKY_INTERACTION_NOT_FOUND,
        'Worky interaction not found.',
      );
    }
    const interaction = await this.interactionModel.findById(interactionId).lean().exec();
    if (!interaction) {
      throw new NotFoundException(
        ErrorCode.WORKY_INTERACTION_NOT_FOUND,
        'Worky interaction not found.',
      );
    }
    const stream = await this.streams.findById(interaction.streamId).lean().exec();
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (stream.ownerUserId.toString() !== user._id.toString()) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky interaction.',
      );
    }
    const preparedTurn: PreparedWorkyTurn | null = dto.cancel
      ? null
      : await this.kickoff.prepare({
          streamId: interaction.streamId.toString(),
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
      const planDeltaId =
        (interaction.metadata as Record<string, unknown> | undefined)?.planDeltaId;
      if (typeof planDeltaId === 'string' && Types.ObjectId.isValid(planDeltaId)) {
        const pending = await this.planDeltas
          .findById(planDeltaId)
          .lean()
          .exec();
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

import { Injectable } from '@nestjs/common';
import { WorkyInteractionRepository } from '../persistence/worky-interaction.repository';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { LoggerService } from '../../logger';
import {
  ConflictException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { RespondWorkyInteractionDto } from '../dto/respond-worky-interaction.dto';
import { WorkyEventService } from './worky-event.service';

export interface RespondInteractionInput {
  userId: string;
  interactionId: string;
  dto: RespondWorkyInteractionDto;
}

export interface RespondInteractionResult {
  interactionId: string;
  streamId: string;
  status: 'responded' | 'canceled';
  response: string;
  verdict: 'approved' | 'rejected' | null;
  followUpTurnStarted: boolean;
}

/**
 * Interaction lifecycle. Part 2 covers:
 *   - `respond`: records the owner's answer, marks the interaction as
 *     `responded` (or `canceled`), emits `interaction.responded` over
 *     SSE, and triggers a follow-up planning turn so the Manager can
 *     resolve and re-delta.
 *
 * Future Parts extend with approval-gate resolution (Part 3) and
 * budget-decision interactions (Part 4).
 */
@Injectable()
export class WorkyInteractionService {
  constructor(
    private readonly interactions: WorkyInteractionRepository,
    private readonly streams: WorkyStreamRepository,
    private readonly events: WorkyEventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyInteractionService.name);
  }

  async respond(input: RespondInteractionInput): Promise<RespondInteractionResult> {
    const existing = await this.interactions.findById(input.interactionId);
    if (!existing) {
      throw new NotFoundException(
        ErrorCode.WORKY_INTERACTION_NOT_FOUND,
        'Worky interaction not found.',
      );
    }
    const cancel = input.dto.cancel === true;
    const responseContent = cancel ? '' : input.dto.content;
    // Only a still-pending interaction takes the answer, so two concurrent
    // responses cannot both win.
    const interaction = await this.interactions.respond(existing.id, {
      status: cancel ? 'canceled' : 'responded',
      response: responseContent,
    });
    if (!interaction) {
      throw new ConflictException(
        ErrorCode.WORKY_INTERACTION_ALREADY_RESPONDED,
        'Worky interaction is no longer pending.',
      );
    }

    // For approval-like interactions, derive a verdict from the
    // `approve` flag and emit it as part of the event so the runtime
    // can re-bind tools (approved) or trigger replan (rejected). The
    // verdict is also returned to the controller.
    //
    // `replan_review` is treated as approval-like because the
    // controller uses `verdict === 'approved'` as the gate for
    // `applyApproved()` (canonical §17.4). If we leave the verdict
    // null for replan_review, the apply path is dead code.
    const isApprovalLike =
      interaction.type === 'approval' || interaction.type === 'replan_review';
    const verdict: 'approved' | 'rejected' | null =
      isApprovalLike && !cancel
        ? input.dto.approve === false
          ? 'rejected'
          : 'approved'
        : null;

    // Resolve the stream owner so the SSE frame reaches the
    // connection that actually subscribed. `WorkyEventService.emit`
    // keys pipes by `${userId}:${streamId}`; broadcasting under
    // `streamId` would never reach the owner's open SSE pipe.
    const stream = await this.streams.findById(interaction.streamId);
    const ownerUserId = stream?.ownerUserId ?? '';
    if (!ownerUserId) {
      this.logger.warn('interaction.responded: stream not found; dropping SSE', {
        interactionId: interaction.id,
        streamId: interaction.streamId,
      });
    }
    this.events.emit(ownerUserId, interaction.streamId, {
      type: 'interaction.responded',
      emittedAt: Date.now(),
      payload: {
        interactionId: interaction.id,
        type: interaction.type,
        taskId: interaction.taskId,
        status: interaction.status,
        response: responseContent,
        verdict,
        blocksTaskIds: interaction.blocksTaskIds,
      },
    });
    this.logger.log('Worky interaction responded', {
      interactionId: interaction.id,
      streamId: interaction.streamId,
      status: interaction.status,
      type: interaction.type,
      verdict,
    });
    return {
      interactionId: interaction.id,
      streamId: interaction.streamId,
      status: interaction.status as 'responded' | 'canceled',
      response: responseContent,
      verdict,
      // The follow-up turn is started by the controller; the service
      // only marks the interaction. Keeping the seam explicit lets the
      // controller test the planning-relay side without mocking the
      // interaction service.
      followUpTurnStarted: false,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
import { WorkyOrchestratorGrpcClientService } from './worky-orchestrator.grpc-client.service';
import { WorkyTurnContextService } from './worky-turn-context.service';
import { fullReplyText } from './worky-mail-token';

/**
 * Teams reply poller.
 *
 * Unlike mail — one Graph push subscription per mailbox catches every reply —
 * Teams change-notifications are per-chat, and the chat id only exists after
 * worky's MCP has sent the message, in worky's own wait store. Rather than teach
 * the backend to subscribe to each chat (create/validate/renew/delete a
 * subscription per outstanding question), this polls: ask worky which chats are
 * open, read each for a human reply, hand any back. A human replying to a Teams
 * message is a minutes-to-hours event, so the poll interval is not a latency
 * that matters, and it removes an entire subscription lifecycle from the
 * failure surface.
 *
 * It stays correct because worky's claim is one-shot: re-offering a message
 * already delivered is a no-op, and a claimed wait drops off listOpenChatWaits,
 * which is what stops the poll for it.
 */

/** Look back this far each tick so a reply just before the tick is not missed. */
const LOOKBACK_MS = 5 * 60 * 1000;
/** getM365ValidToken resolves the real key from this preferred hint (as mail does). */
const PREFERRED_APP_KEY = 'microsoft';

interface UserPollContext {
  myId: string;
  agents: unknown[];
  connectors: unknown[];
}

@Injectable()
export class WorkyTeamsCatchupService {
  constructor(
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkyTeamsCatchup');
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweep(): Promise<void> {
    let waits: { chatId: string; userId: string; sessionId: string }[];
    try {
      waits = await this.orchestrator.listOpenChatWaits();
    } catch (err) {
      // Orchestrator down or unreachable: nothing to do this tick, try next.
      this.logger.debug('listOpenChatWaits failed', { error: (err as Error).message });
      return;
    }
    if (!waits.length) return;
    this.logger.log('Teams poll tick', { openChats: waits.length });

    // The token, own-id and agents/connectors are per user, not per chat, so
    // resolve them once per user per tick.
    const perUser = new Map<string, UserPollContext>();
    for (const wait of waits) {
      try {
        await this.pollChat(wait, perUser);
      } catch (err) {
        this.logger.warn('Teams poll failed for a chat', {
          chatId: wait.chatId,
          error: (err as Error).message,
        });
      }
    }
  }

  private async userContext(
    userId: string,
    perUser: Map<string, UserPollContext>,
  ): Promise<UserPollContext> {
    const cached = perUser.get(userId);
    if (cached) return cached;
    // Without agents/connectors the resumed plan rebuilds not-yet-run steps with
    // zero tools and silently fabricates "done" results — same hazard as mail.
    const [myId, agents, connectors] = await Promise.all([
      this.graphClient.getMyId(userId, PREFERRED_APP_KEY),
      this.turnContext.resolveWorkyAgents(userId),
      this.turnContext.resolveConnectors(userId),
    ]);
    const ctx: UserPollContext = { myId, agents, connectors };
    perUser.set(userId, ctx);
    return ctx;
  }

  private async pollChat(
    wait: { chatId: string; userId: string },
    perUser: Map<string, UserPollContext>,
  ): Promise<void> {
    const ctx = await this.userContext(wait.userId, perUser);
    const since = new Date(Date.now() - LOOKBACK_MS);
    // ponytail: fixed lookback, no per-chat cursor — claim-once makes replay a
    // no-op and a claimed wait leaves the list. Add a cursor only if the Graph
    // call volume per open chat ever matters.
    const messages = await this.graphClient.listChatMessagesSince(
      wait.userId,
      PREFERRED_APP_KEY,
      wait.chatId,
      since,
    );

    for (const message of messages) {
      const fromId = (message.from as Record<string, any>)?.user?.id as string | undefined;
      // Skip worky's OWN outgoing message: the chat has no token to check, so
      // the chat membership is the trust boundary — but our own send is a member
      // of it too, and must never be fed back as the reply.
      if (!fromId || fromId === ctx.myId) continue;

      const replyBody = fullReplyText(
        message.body as { contentType?: string; content?: string },
        undefined,
      );
      if (!replyBody) continue;
      const replyFrom =
        ((message.from as Record<string, any>)?.user?.displayName as string) ?? '';

      const result = await this.orchestrator.deliverChatReply({
        chatId: wait.chatId,
        replyBody,
        replyFrom,
        agents: ctx.agents,
        connectors: ctx.connectors,
      });
      if (result.delivered) {
        this.logger.log('Teams reply delivered to a waiting step', {
          sessionId: result.sessionId,
          stepId: result.stepId,
          replyFrom,
        });
        // The wait is claimed; the rest of this chat's messages are older or
        // already-answered, so stop here and let it drop off the next tick.
        break;
      }
    }
  }
}

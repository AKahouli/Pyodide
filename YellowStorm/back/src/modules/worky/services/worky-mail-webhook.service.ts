import { timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
import { WorkyMailSubscriptionService } from './worky-mail-subscription.service';
import { WorkyOrchestratorGrpcClientService } from './worky-orchestrator.grpc-client.service';
import { WorkyTurnContextService } from './worky-turn-context.service';
import { extractMailToken, fullReplyText } from './worky-mail-token';

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
  resource?: string;
  resourceData?: { id?: string };
}

/** Constant-time, so a mismatch leaks nothing about how close a guess was. */
function secretsMatch(a: string, b: string): boolean {
  const x = Buffer.from(a ?? '', 'utf8');
  const y = Buffer.from(b ?? '', 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

/**
 * A mail arrived in a subscribed inbox: work out whether any worky step was
 * waiting for it, and if so hand it over.
 *
 * Most notifications are not ours. The subscription fires for every mail the
 * user receives, so the common path is "no routing token, ignore" — that has to
 * be cheap and silent, not an error.
 */
@Injectable()
export class WorkyMailWebhookService {
  constructor(
    private readonly subscriptions: WorkyMailSubscriptionService,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkyMailWebhook');
  }

  async handleNotifications(body: { value?: GraphNotification[] }): Promise<{ handled: number }> {
    const notifications = body?.value ?? [];
    let handled = 0;
    for (const notification of notifications) {
      try {
        if (await this.handleOne(notification)) handled += 1;
      } catch (err) {
        // Never let one bad notification sink the batch: the caller must still
        // ack, or Graph retries and eventually kills the subscription.
        this.logger.error('Mail notification failed', { error: (err as Error).message });
      }
    }
    return { handled };
  }

  private async handleOne(notification: GraphNotification): Promise<boolean> {
    const subscription = await this.subscriptions.findByClientState(notification.clientState ?? '');
    if (!subscription) return false;

    // clientState alone proves the caller knew the secret; check the id it
    // claims matches the one we issued for that secret.
    if (
      !subscription.clientState ||
      !secretsMatch(subscription.clientState, notification.clientState ?? '') ||
      subscription.subscriptionId !== notification.subscriptionId
    ) {
      this.logger.warn('Rejected mail notification with mismatched subscription');
      return false;
    }

    // Graph sends only ids; the mail itself has to be fetched with the user's
    // token (getMessageByResource also handles EWS/immutable-id translation).
    const message = await this.graphClient.getMessageByResource(
      subscription.userId,
      subscription.mailboxAppKey,
      notification.resource ?? `me/messages/${notification.resourceData?.id ?? ''}`,
    );
    if (!message) return false;

    const subject = (message.subject as string) ?? '';
    const bodyContent = ((message.body as Record<string, unknown>)?.content as string) ?? '';
    const token = extractMailToken(subject, bodyContent);
    if (!token) return false; // Not a reply to anything worky sent — the usual case.

    const replyText = fullReplyText(
      message.body as { contentType?: string; content?: string },
      message.bodyPreview as string,
    );
    const replyFrom =
      (((message.from as Record<string, any>)?.emailAddress?.address as string) ?? '').trim();

    // Without these the resumed plan rebuilds every not-yet-run step with NO
    // agents/tools at all: a step needing none (writing a report) looks fine,
    // but a step that needed one (sending that report onward) silently
    // fabricates a "done" result and never calls the real tool -- completed,
    // nothing sent.
    const [agents, connectors] = await Promise.all([
      this.turnContext.resolveWorkyAgents(subscription.userId),
      this.turnContext.resolveConnectors(subscription.userId),
    ]);

    // worky owns the token->step mapping and resolves it; a duplicate delivery
    // (Graph retries whatever it thinks failed) comes back delivered=false.
    const result = await this.orchestrator.deliverMailReply({
      token,
      replyBody: replyText,
      replyFrom,
      agents,
      connectors,
    });

    if (result.delivered) {
      this.logger.log('Mail reply delivered to a waiting step', {
        sessionId: result.sessionId, stepId: result.stepId, replyFrom,
      });
    } else {
      this.logger.debug('Mail reply not deliverable (duplicate, expired or unknown token)');
    }
    return result.delivered;
  }
}

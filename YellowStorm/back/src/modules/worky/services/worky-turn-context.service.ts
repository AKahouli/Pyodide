import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ModelsService } from '@modules/models/models.service';
import { ConnectorService } from '@modules/connector/connector.service';
import { WorkyMailSubscriptionService } from './worky-mail-subscription.service';

const WORKY_CONNECTOR_SLUGS = ['code-interpreter', 'linkup', 'microsoft365'];

/**
 * Resolves the model and connectors an orchestrator turn needs to actually do
 * its job with real tools — shared by every path that can start or continue a
 * turn: a fresh message, a paused-session resume, and a mail-reply resume.
 *
 * The mail-reply path existed without this and it showed: DeliverMailReply
 * was called with no connectors at all, so resume_turn rebuilt every not-yet-
 * run step with zero tools. A step needing no tool (writing a report) looked
 * fine; a step that needed one (sending the report onward) silently produced
 * a made-up "done" and never called send_email — completed, but nothing was
 * ever sent. Two callers independently forgetting the same resolution is
 * exactly the shape of bug that recurs, so it is centralized here once.
 */
@Injectable()
export class WorkyTurnContextService {
  constructor(
    private readonly models: ModelsService,
    private readonly connectorService: ConnectorService,
    private readonly mailSubscriptions: WorkyMailSubscriptionService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyTurnContextService.name);
  }

  /** Manager model priority: given value -> admin default. Returns undefined
   *  only if no model resolves (RunTask/DeliverMailReply treat it as optional). */
  async resolveManagerModel(preferred: string | null): Promise<string | undefined> {
    let model = preferred || null;
    if (!model) {
      model = this.models.getModelIdentifier(await this.models.getDefaultModel()) || null;
    }
    return model ?? undefined;
  }

  /** Per-user connectors worky needs (code-interpreter, linkup, microsoft365).
   *  Auth resolved by ConnectorService; failures are non-fatal (send none) --
   *  a turn or resume must not fail just because connector lookup did. */
  async resolveConnectors(userId: string): Promise<unknown[]> {
    try {
      const found = (
        await Promise.all(WORKY_CONNECTOR_SLUGS.map((slug) => this.connectorService.findBySlug(slug)))
      ).filter(Boolean);
      if (found.length) {
        if (found.some((c) => c!.slug === 'microsoft365')) this.ensureMailSubscription(userId);
        return await this.connectorService.findByIdsForGrpc(
          found.map((c) => c!.id),
          userId,
        );
      }
    } catch (err) {
      this.logger.warn('[worky-orchestrator] connector resolution failed; sending none', {
        error: (err as Error).message,
      });
    }
    return [];
  }

  /**
   * A turn that can send mail is a turn whose mail may be replied to, so the
   * mailbox needs a live Graph subscription before the reply arrives — the
   * subscription cannot be created retroactively once the mail is out.
   *
   * Fire-and-forget: the caller must not fail just because a subscription
   * problem did. The worst case is a reply that routes late (poll) or not at
   * all, which the wait's own expiry already covers.
   */
  private ensureMailSubscription(userId: string): void {
    void this.mailSubscriptions.ensureForUser(userId).catch((err) => {
      this.logger.warn('[worky-orchestrator] mail subscription unavailable', {
        error: (err as Error).message,
      });
    });
  }
}

import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ModelsService } from '@modules/models/models.service';
import { ConnectorService } from '@modules/connector/connector.service';
import { AgentService } from '@modules/agent/agent.service';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import { WorkyMailSubscriptionService } from './worky-mail-subscription.service';
import {
  WORKY_PLANNER_AGENT_TYPE_SLUG,
  WORKY_EXECUTOR_AGENT_TYPE_SLUG,
} from '../constants/worky.constants';

/**
 * Split out of the single `microsoft365` connector into the three focused
 * servers behind it: outlook (mail/calendar), sharepoint (files) and teams.
 * Same Graph surface, but each server ships on its own — which is what lets
 * outlook gain send_email attachments without redeploying the file tools.
 *
 * `outlook` must stay in this list for reasons beyond its tools: it is what
 * arms the Graph mail subscription below, and every await_reply step in every
 * plan is resumed by that webhook.
 */
const WORKY_MAIL_CONNECTOR_SLUG = 'outlook';
const WORKY_CONNECTOR_SLUGS = [
  'code-interpreter',
  'linkup',
  WORKY_MAIL_CONNECTOR_SLUG,
  'sharepoint',
  'teams',
  'githubpoc',
];

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
    private readonly agentService: AgentService,
    private readonly agentTypeService: AgentTypeService,
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

  /**
   * The two agents every orchestrator turn forwards: the admin's default agent
   * of type `worky-planner` and of type `worky-executer`, built into the full
   * gRPC `chatbot.Agent` shape (tools / prompt / model / connectors resolved by
   * AgentService). Replaces the old per-stream planner/executor model + prompt
   * overrides — the agents now carry that config.
   *
   * Non-fatal by design (mirrors `resolveConnectors`): a misconfigured or
   * missing default agent must not fail the turn. We log and send whatever
   * resolves; the orchestrator falls back to its own defaults for the rest.
   */
  async resolveWorkyAgents(userId: string): Promise<unknown[]> {
    try {
      const [plannerType, executorType] = await Promise.all([
        this.agentTypeService.findBySlug(WORKY_PLANNER_AGENT_TYPE_SLUG),
        this.agentTypeService.findBySlug(WORKY_EXECUTOR_AGENT_TYPE_SLUG),
      ]);
      if (!plannerType || !executorType) {
        this.logger.warn('[worky-orchestrator] planner/executor agent type missing; sending none', {
          plannerType: plannerType?.id ?? null,
          executorType: executorType?.id ?? null,
        });
      }

      const [plannerAgent, executorAgent] = await Promise.all([
        plannerType ? this.agentService.findDefaultByAgentType(plannerType.id) : null,
        executorType ? this.agentService.findDefaultByAgentType(executorType.id) : null,
      ]);

      const agentIds = [plannerAgent?.id, executorAgent?.id].filter(Boolean) as string[];
      if (agentIds.length === 0) {
        this.logger.warn('[worky-orchestrator] no default planner/executor agents resolved; sending none', {
          userId,
        });
        return [];
      }
      if (agentIds.length < 2) {
        this.logger.warn('[worky-orchestrator] only one default worky agent resolved', {
          userId,
          plannerAgent: plannerAgent?.id ?? null,
          executorAgent: executorAgent?.id ?? null,
        });
      }

      return await this.agentService.buildGrpcAgentsForPlaybook(userId, agentIds);
    } catch (err) {
      this.logger.warn('[worky-orchestrator] worky agent resolution failed; sending none', {
        userId,
        error: (err as Error).message,
      });
      return [];
    }
  }

  /** Per-user connectors worky needs (see WORKY_CONNECTOR_SLUGS).
   *  Auth resolved by ConnectorService; failures are non-fatal (send none) --
   *  a turn or resume must not fail just because connector lookup did. */
  async resolveConnectors(userId: string): Promise<unknown[]> {
    try {
      const found = (
        await Promise.all(WORKY_CONNECTOR_SLUGS.map((slug) => this.connectorService.findBySlug(slug)))
      ).filter(Boolean);
      if (found.length) {
        // Tied to the mail connector by name, not to "some Microsoft connector
        // is present": sharepoint and teams are Graph too, and arming the mail
        // webhook off either of them would subscribe a mailbox whose send_email
        // tool the plan never had.
        if (found.some((c) => c!.slug === WORKY_MAIL_CONNECTOR_SLUG)) {
          this.ensureMailSubscription(userId);
        }
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

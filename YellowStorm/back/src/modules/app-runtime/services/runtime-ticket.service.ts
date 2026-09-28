import { Injectable,  Logger,  Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { RuntimeTicketResult } from '../types/app-runtime-protocol';
import { RuntimeBindingService } from './runtime-binding.service';
import { RuntimeTokenService } from './runtime-token.service';
import { AppDataDeploymentService } from '@modules/app-data/services/app-data-deployment.service';
import { PgRuntimeTicketStore } from '../persistence/pg-runtime-ticket.store';

export interface IssueRuntimeTicketParams {
  conversationSessionId: string;
  userId: string;
}

export interface ConsumedRuntimeTicket {
  runtimeSessionId: string;
  bindingId: string;
  workspaceId: string;
  userId: string;
}

/**
 * Issues and redeems the one-shot credential used to open the `/app-runtime`
 * socket. The MCP token never travels this path: the browser only ever holds a
 * ticket scoped to its own workspace.
 */
@Injectable()
export class RuntimeTicketService {
  private readonly logger = new Logger(RuntimeTicketService.name);

  constructor(
    private readonly store: PgRuntimeTicketStore,
    private readonly bindings: RuntimeBindingService,
    private readonly tokens: RuntimeTokenService,
    private readonly config: ConfigService,
    @Optional() private readonly appDataDeployment?: AppDataDeploymentService,
  ) {}

  async issue(params: IssueRuntimeTicketParams): Promise<RuntimeTicketResult> {
    const { conversationSessionId, userId } = params;
    const binding = await this.bindings.ensureForSession(
      conversationSessionId,
      userId,
    );

    const ticket = randomBytes(32).toString('base64url');
    const runtimeSessionId = `rts_${randomBytes(8).toString('hex')}`;
    const ttlMs = this.config.get<number>('appRuntime.ticketTtlMs', 60_000);
    const expiresAt = new Date(Date.now() + ttlMs);

    await this.store.create({
      runtimeSessionId,
      ticketHash: this.tokens.hash(ticket),
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      userId,
      expiresAt,
    });

    this.logger.debug(
      `Issued runtime ticket runtimeSessionId=${runtimeSessionId} workspaceId=${binding.workspaceId}`,
    );

    const appDataRuntimeEnv = this.appDataDeployment
      ? await this.appDataDeployment.getRuntimeEnvForWorkspace(binding.workspaceId, 'dev')
      : null;

    return {
      runtimeSessionId,
      ticket,
      workspaceId: binding.workspaceId,
      revisionId: binding.latestRevisionId,
      expiresAt: expiresAt.toISOString(),
      ...(appDataRuntimeEnv ? { appDataRuntimeEnv } : {}),
    };
  }

  /**
   * Redeem a ticket. The filter and the update are a single atomic operation,
   * so two concurrent handshakes with the same ticket cannot both succeed.
   * Returns null for unknown, expired and already consumed tickets alike.
   */
  async consume(ticket: string): Promise<ConsumedRuntimeTicket | null> {
    if (!ticket) return null;

    const consumed = await this.store.consumeByHash(this.tokens.hash(ticket));

    if (!consumed) return null;

    return {
      runtimeSessionId: consumed.runtimeSessionId,
      bindingId: consumed.bindingId,
      workspaceId: consumed.workspaceId,
      userId: consumed.userId,
    };
  }
}

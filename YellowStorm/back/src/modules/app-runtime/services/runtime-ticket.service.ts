import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
import {
  AppRuntimeTicket,
  AppRuntimeTicketDocument,
} from '../schemas/app-runtime-ticket.schema';
import type { RuntimeTicketResult } from '../types/app-runtime-protocol';
import { RuntimeBindingService } from './runtime-binding.service';
import { RuntimeTokenService } from './runtime-token.service';

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
    @InjectModel(AppRuntimeTicket.name)
    private readonly model: Model<AppRuntimeTicketDocument>,
    private readonly bindings: RuntimeBindingService,
    private readonly tokens: RuntimeTokenService,
    private readonly config: ConfigService,
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

    await this.model.create({
      runtimeSessionId,
      ticketHash: this.tokens.hash(ticket),
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      userId,
      expiresAt,
      consumedAt: null,
    });

    this.logger.debug(
      `Issued runtime ticket runtimeSessionId=${runtimeSessionId} workspaceId=${binding.workspaceId}`,
    );

    return {
      runtimeSessionId,
      ticket,
      workspaceId: binding.workspaceId,
      revisionId: binding.latestRevisionId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Redeem a ticket. The filter and the update are a single atomic operation,
   * so two concurrent handshakes with the same ticket cannot both succeed.
   * Returns null for unknown, expired and already consumed tickets alike.
   */
  async consume(ticket: string): Promise<ConsumedRuntimeTicket | null> {
    if (!ticket) return null;

    const consumed = await this.model
      .findOneAndUpdate(
        {
          ticketHash: this.tokens.hash(ticket),
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { consumedAt: new Date() } },
        { new: true },
      )
      .lean()
      .exec();

    if (!consumed) return null;

    return {
      runtimeSessionId: consumed.runtimeSessionId,
      bindingId: consumed.bindingId,
      workspaceId: consumed.workspaceId,
      userId: consumed.userId,
    };
  }
}

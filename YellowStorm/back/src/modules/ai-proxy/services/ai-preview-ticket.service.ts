import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { RuntimeBindingService } from '../../app-runtime/services/runtime-binding.service';
import { RuntimeTokenService } from '../../app-runtime/services/runtime-token.service';
import {
  AI_PREVIEW_TICKET_STORE,
  type AiPreviewTicketStore,
} from '../persistence/ai-preview-ticket.store';

export const AI_PREVIEW_TICKET_PREFIX = 'aiprev_';

export interface IssueAiPreviewTicketParams {
  conversationSessionId: string;
  /** Session owner — billed for preview AI usage. */
  billableUserId: string;
}

export interface AiPreviewTicketResult {
  ticket: string;
  workspaceId: string;
  bindingId: string;
  expiresAt: string;
}

export interface VerifiedAiPreviewTicket {
  workspaceId: string;
  bindingId: string;
  conversationSessionId: string;
  billableUserId: string;
}

/**
 * Issues and verifies reusable AI preview tickets for the parent-frame relay.
 * Plaintext never leaves the issuer response + BrowserRuntimeHost memory.
 */
@Injectable()
export class AiPreviewTicketService {
  private readonly logger = new Logger(AiPreviewTicketService.name);

  constructor(
    @Inject(AI_PREVIEW_TICKET_STORE)
    private readonly store: AiPreviewTicketStore,
    private readonly bindings: RuntimeBindingService,
    private readonly tokens: RuntimeTokenService,
    private readonly config: ConfigService,
  ) {}

  async issue(params: IssueAiPreviewTicketParams): Promise<AiPreviewTicketResult> {
    const { conversationSessionId, billableUserId } = params;
    const binding = await this.bindings.ensureForSession(
      conversationSessionId,
      billableUserId,
    );

    const ttlMs = this.config.get<number>('aiProxy.previewTicketTtlMs', 600_000);
    const expiresAt = new Date(Date.now() + ttlMs);
    const ticket = `${AI_PREVIEW_TICKET_PREFIX}${randomBytes(32).toString('base64url')}`;

    // Expire prior live tickets for this workspace so rotations stay tight.
    await this.store.expireLiveForWorkspace(binding.workspaceId);

    await this.store.create({
      ticketHash: this.tokens.hash(ticket),
      conversationSessionId,
      workspaceId: binding.workspaceId,
      bindingId: binding.bindingId,
      billableUserId,
      purpose: 'ai_preview',
      expiresAt,
    });

    this.logger.debug(
      `Issued AI preview ticket workspaceId=${binding.workspaceId} ttlMs=${ttlMs}`,
    );

    return {
      ticket,
      workspaceId: binding.workspaceId,
      bindingId: binding.bindingId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Multi-use verify until TTL; does not consume. */
  async verify(ticket: string): Promise<VerifiedAiPreviewTicket | null> {
    if (!ticket?.startsWith(AI_PREVIEW_TICKET_PREFIX)) {
      return null;
    }

    const doc = await this.store.findLiveByHash(
      this.tokens.hash(ticket),
      'ai_preview',
    );

    if (!doc) return null;

    return {
      workspaceId: doc.workspaceId,
      bindingId: doc.bindingId,
      conversationSessionId: doc.conversationSessionId,
      billableUserId: doc.billableUserId,
    };
  }
}

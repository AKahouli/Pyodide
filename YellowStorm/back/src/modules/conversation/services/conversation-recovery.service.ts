import { Injectable,  OnModuleDestroy,  OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';
import { StreamGatewayService } from './stream-gateway.service';
import { PostgresConversationExecutionStore } from '../persistence/postgres/postgres-conversation-execution-store';

export const RECOVERY_BATCH_LIMIT = 100;

/** Postgres codes meaning the recovery schema (migration 0010) is absent. */
const SCHEMA_MISSING_CODES = new Set(['42P01', '42703']);

/**
 * Standard-chat recovery coordinator (WP06.5).
 *
 * Scans for streaming AI attempts whose execution lease expired (the owner
 * stopped renewing — crash, kill, partition) and settles them truthfully as
 * `interrupted` instead of leaving an endless spinner. The settlement is an
 * atomic conditional update keyed on lease expiry, so two replicas racing
 * converge on exactly one write and a healthy long-running run (which keeps
 * renewing its lease) is never touched.
 *
 * No terminal journal exists in this pass: an expired attempt becomes
 * `interrupted`, never silently `completed` — no false durability claims.
 */
@Injectable()
export class ConversationRecoveryService implements OnModuleInit, OnModuleDestroy {
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryInFlight = false;
  private schemaMissingLogged = false;

  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly graceMs: number;

  constructor(
    private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
    private readonly streamGateway: StreamGatewayService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly executionStore: PostgresConversationExecutionStore,
  ) {
    this.logger.setContext(ConversationRecoveryService.name);
    this.enabled = this.configService.get<boolean>('conversation.recoveryEnabled', true);
    this.intervalMs = this.configService.get<number>('conversation.recoveryIntervalMs', 30_000);
    this.graceMs = this.configService.get<number>('conversation.recoveryGraceMs', 60_000);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Standard-run recovery worker disabled by configuration');
      return;
    }
    this.recoveryTimer = setInterval(() => {
      void this.runRecoveryPass();
    }, this.intervalMs);
    this.recoveryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /** Single recovery pass. Exposed for tests and manual triggering. */
  async runRecoveryPass(): Promise<{ scanned: number; interrupted: number }> {
    if (this.recoveryInFlight) {
      return { scanned: 0, interrupted: 0 };
    }
    this.recoveryInFlight = true;
    try {
      // Grace period: only settle attempts whose lease expired a while ago,
      // so a renewal that is seconds late is not racing the recovery worker.
      const cutoff = new Date(Date.now() - this.graceMs);
      const now = new Date();
      const expired = await this.messageService
        .findExpiredStreamExecutions(cutoff, RECOVERY_BATCH_LIMIT)
        .catch((error: unknown) => {
          if (this.isSchemaMissing(error)) {
            if (!this.schemaMissingLogged) {
              this.schemaMissingLogged = true;
              this.logger.error(
                'Recovery schema missing — migration 0010 not applied. Recovery worker is disabled for this process; apply the migration and restart.',
              );
            }
            return null;
          }
          this.logger.error('Recovery scan failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
      if (!expired || expired.length === 0) {
        return { scanned: 0, interrupted: 0 };
      }

      let interrupted = 0;
      for (const attempt of expired) {
        try {
          const settled = await this.messageService.markExecutionInterrupted(
            attempt.id,
            'lease_expired',
            now,
          );
          if (!settled) {
            // Another replica or a late terminal write already settled it.
            continue;
          }
          interrupted += 1;
          await this.notifyInterrupted(settled.id, settled.conversationId);
        } catch (error) {
          this.logger.error('Failed to settle expired execution', {
            messageId: attempt.id,
            conversationId: attempt.conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (interrupted > 0) {
        this.logger.warn('Recovery pass settled interrupted executions', {
          scanned: expired.length,
          interrupted,
        });
      }

      // Reclaim shared capacity slots whose owner vanished without finalizing
      // (crash between message terminal write and admission-row finalize).
      await this.executionStore.finalizeExpired(now).catch((error: unknown) => {
        this.logger.error('Failed to finalize expired admission rows', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return { scanned: expired.length, interrupted };
    } finally {
      this.recoveryInFlight = false;
    }
  }

  private isSchemaMissing(error: unknown): boolean {
    const code = (error as { code?: string; cause?: { code?: string } } | null)?.code
      ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
    return code !== undefined && SCHEMA_MISSING_CODES.has(code);
  }

  /** Best-effort convergence event; never fails the settlement. */
  private async notifyInterrupted(messageId: string, conversationId: string): Promise<void> {
    try {
      const members = await this.resolveMemberIds(conversationId);
      if (members.length === 0) {
        return;
      }
      await this.streamGateway.broadcastToConversation(members, {
        type: 'stream_error',
        data: {
          conversationId,
          messageId,
          errorCode: ErrorCode.CHAT_STREAM_FAILED,
          message: 'Generation was interrupted and can be retried.',
        },
      });
    } catch {
      // Members unavailable during an outage: durable state already converged;
      // the browser reconciles via replay/active-stream on next connect.
    }
  }

  private async resolveMemberIds(conversationId: string): Promise<string[]> {
    try {
      const conversation = await this.conversationService.findById(conversationId);
      const userIds: string[] = [conversation.createdBy];
      if (conversation.groupMeta?.isGroup) {
        conversation.groupMeta.members.forEach((member) => {
          if (!userIds.includes(member.userId)) {
            userIds.push(member.userId);
          }
        });
      }
      return userIds;
    } catch {
      return [];
    }
  }
}

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';
import { SystemService } from '@modules/system/system.service';
import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';
import { PlaybookTokenStreamRedactor } from '../utils/playbook-artifact';

type TokenBufferKey = {
  executionId: string;
  taskId: string;
  iteration: number;
};

type TokenBufferEntry = TokenBufferKey & {
  chunks: string[];
  bytes: number;
  timer?: NodeJS.Timeout;
  createdAt: number;
};

/**
 * Buffers streaming node tokens in memory so token-heavy executions do not write
 * to MongoDB once per token while preserving immediate SSE updates for the UI.
 */
@Injectable()
export class PlaybookFlowTokenBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaybookFlowTokenBufferService.name);
  private readonly buffers = new Map<string, TokenBufferEntry>();
  private readonly streamRedactor = new PlaybookTokenStreamRedactor();
  private readonly publicTokenKeys = new Map<string, TokenBufferKey>();

  constructor(
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
    private readonly configService: ConfigService,
    private readonly systemService: SystemService,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    return (await this.systemService.getPlaybookSettings()).playbookExecution.tokenBufferEnabled;
  }

  async appendToken(key: TokenBufferKey, token: string): Promise<void> {
    if (!token) return;
    this.emitPublicToken(key, token);

    const maxTaskBytes = this.getMaxTaskBytes();
    if (Buffer.byteLength(token, 'utf8') >= maxTaskBytes) {
      await this.flushToken(key, token);
      return;
    }

    const entry = this.getOrCreateEntry(key);
    entry.chunks.push(token);
    entry.bytes += Buffer.byteLength(token, 'utf8');

    if (entry.bytes >= this.getMaxBytes()) {
      await this.flushKey(this.keyOf(key));
    }
  }

  async flushTask(key: TokenBufferKey): Promise<void> {
    this.flushPublicToken(key);
    await this.flushKey(this.keyOf(key));
  }

  async flushExecution(executionId: string): Promise<void> {
    const publicKeys = Array.from(this.publicTokenKeys.values()).filter((entry) => entry.executionId === executionId);
    publicKeys.forEach((entry) => this.flushPublicToken(entry));
    const keys = Array.from(this.buffers.keys()).filter((key) => key.startsWith(`${executionId}:`));
    for (const key of keys) {
      await this.flushKey(key);
    }
  }

  discardExecution(executionId: string): void {
    this.streamRedactor.discardExecution(executionId);
    for (const [key, value] of this.publicTokenKeys.entries()) {
      if (value.executionId === executionId) this.publicTokenKeys.delete(key);
    }
    for (const [key, entry] of this.buffers.entries()) {
      if (entry.executionId === executionId) {
        this.clearEntryTimer(entry);
        this.buffers.delete(key);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    Array.from(this.publicTokenKeys.values()).forEach((key) => this.flushPublicToken(key));
    for (const key of Array.from(this.buffers.keys())) {
      await this.flushKey(key);
    }
  }

  emitPublicToken(key: TokenBufferKey, token: string): void {
    const bufferKey = this.keyOf(key);
    this.publicTokenKeys.set(bufferKey, key);
    const publicToken = this.streamRedactor.push(bufferKey, token);
    if (publicToken) this.streamEvents.emitStepUpdate(key.executionId, key.taskId, publicToken);
  }

  flushPublicToken(key: TokenBufferKey): void {
    const bufferKey = this.keyOf(key);
    this.publicTokenKeys.delete(bufferKey);
    const publicToken = this.streamRedactor.flush(bufferKey);
    if (publicToken) this.streamEvents.emitStepUpdate(key.executionId, key.taskId, publicToken);
  }

  private getOrCreateEntry(key: TokenBufferKey): TokenBufferEntry {
    const bufferKey = this.keyOf(key);
    const existing = this.buffers.get(bufferKey);
    if (existing) return existing;

    this.makeRoomForNewBuffer();
    const entry: TokenBufferEntry = { ...key, chunks: [], bytes: 0, createdAt: Date.now() };
    entry.timer = setTimeout(() => {
      this.flushKey(bufferKey).catch((err) => {
        this.logger.error(`Failed to flush token buffer ${bufferKey}`, err instanceof Error ? err.stack : undefined);
      });
    }, this.getFlushIntervalMs());
    this.buffers.set(bufferKey, entry);
    return entry;
  }

  private makeRoomForNewBuffer(): void {
    const maxActiveBuffers = this.configService.get<number>('playbook-flow.tokenBufferMaxActiveBuffers', 1000);
    if (this.buffers.size < maxActiveBuffers) return;

    const oldest = Array.from(this.buffers.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) return;

    this.logger.warn(`Token buffer cap reached; forcing oldest buffer flush for ${oldest[0]}`);
    this.flushKey(oldest[0]).catch((err) => {
      this.logger.error(`Failed to flush oldest token buffer ${oldest[0]}`, err instanceof Error ? err.stack : undefined);
    });
  }

  private async flushKey(bufferKey: string): Promise<void> {
    const entry = this.buffers.get(bufferKey);
    if (!entry) return;

    this.clearEntryTimer(entry);
    this.buffers.delete(bufferKey);

    const text = entry.chunks.join('');
    if (!text) return;
    await this.flushToken(entry, text);
  }

  private async flushToken(key: TokenBufferKey, token: string): Promise<void> {
    await this.taskResultModel.updateOne(
      { executionId: key.executionId, taskId: key.taskId, iteration: key.iteration },
      [
        {
          $set: {
            status: 'running',
            output: {
              $concat: [{ $ifNull: ['$output', ''] }, token],
            },
          },
        },
      ],
      { upsert: true },
    );
  }

  private clearEntryTimer(entry: TokenBufferEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
  }

  private keyOf(key: TokenBufferKey): string {
    return `${key.executionId}:${key.taskId}:${key.iteration}`;
  }

  private getFlushIntervalMs(): number {
    return this.configService.get<number>('playbook-flow.tokenBufferFlushIntervalMs', 750);
  }

  private getMaxBytes(): number {
    return this.configService.get<number>('playbook-flow.tokenBufferMaxBytes', 4096);
  }

  private getMaxTaskBytes(): number {
    return this.configService.get<number>('playbook-flow.tokenBufferMaxTaskBytes', 65536);
  }
}

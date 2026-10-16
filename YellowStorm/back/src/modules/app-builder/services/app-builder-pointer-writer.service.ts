import { Injectable,  Logger } from '@nestjs/common';
import type { AppBuilderSessionStatus } from '../types/app-builder-persistence.types';
import type { AppBuilderEvent } from '../types/app-builder.types';
import { PgAppBuilderSessionStore } from '../persistence/postgres/pg-app-builder-session.store';

@Injectable()
export class AppBuilderPointerWriterService {
  private readonly logger = new Logger(AppBuilderPointerWriterService.name);

  constructor(
    private readonly store: PgAppBuilderSessionStore,
  ) {}

  async apply(sessionId: string, event: AppBuilderEvent): Promise<void> {
    try {
      const patch: {
        lastEventAt: Date;
        title?: string;
        status?: AppBuilderSessionStatus;
      } = { lastEventAt: new Date() };

      if (event.type === 'title') {
        const next = (event.payload as { title?: string }).title?.trim();
        // Ignore empty titles so a bad AI/name-gen frame cannot wipe a good one.
        if (next) patch.title = next;
      }
      if (event.type === 'message') {
        const role = (event.payload as { role?: string }).role;
        if (role === 'user') {
          patch.status = 'active';
        }
      }
      const statusForType: Record<string, AppBuilderSessionStatus | undefined> = {
        done: 'completed',
        wait: 'waiting',
        error: 'error',
      };
      const next = statusForType[event.type];
      if (next) patch.status = next;

      await this.store.applyPointerPatch(sessionId, patch);
    } catch (err) {
      this.logger.warn(
        `pointer write failed for ${sessionId}: ${(err as Error).message}`,
      );
    }
  }
}

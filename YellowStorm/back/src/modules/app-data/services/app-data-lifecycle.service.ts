import { Injectable } from '@nestjs/common';
import type { AppDataLifecycleState } from '../constants/app-data.constants';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataAuditService } from './app-data-audit.service';

const TRANSITIONS: Record<AppDataLifecycleState, AppDataLifecycleState[]> = {
  active: ['archived'],
  archived: ['purge_pending', 'active'],
  purge_pending: ['purged'],
  purged: [],
};

@Injectable()
export class AppDataLifecycleService {
  constructor(
    private readonly catalog: AppDataCatalogService,
    private readonly audit: AppDataAuditService,
  ) {}

  async transition(workspaceId: string, to: AppDataLifecycleState, actor: string): Promise<void> {
    const app = await this.catalog.requireAppByWorkspace(workspaceId);
    const from = app.lifecycleState as AppDataLifecycleState;
    if (!TRANSITIONS[from]?.includes(to)) {
      throw new Error(`Invalid lifecycle transition ${from} -> ${to}`);
    }
    await this.catalog.updateLifecycle(app.id, to);
    await this.audit.record({
      appId: app.id,
      eventType: 'lifecycle_transition',
      actorPrincipal: actor,
      metadata: { from, to },
    });
  }
}

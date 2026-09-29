import { Injectable, Logger } from '@nestjs/common';
import { RuntimeRevisionService } from '../services/runtime-revision.service';
import {
  planPlatformBaseline,
  type BaselineMode,
  type PlatformBaselinePlan,
} from './platform-baseline.planner';

export type {
  BaselineFile,
  BaselineMode,
  BaselineSource,
  PlatformBaselinePlan,
} from './platform-baseline.planner';

/**
 * Applies the Platform Kit baseline to App Builder revisions: at session seed
 * so the browser boots on a normalized template, and again at deploy as a
 * verification pass.
 */
@Injectable()
export class PlatformBaselineService {
  private readonly logger = new Logger(PlatformBaselineService.name);

  constructor(private readonly revisions: RuntimeRevisionService) {}

  async planBaseline(input: {
    workspaceId: string;
    revisionId: string;
    mode: BaselineMode;
  }): Promise<PlatformBaselinePlan> {
    const { workspaceId, revisionId, mode } = input;
    const revision = await this.revisions.getAuthorizedRevision(workspaceId, revisionId);

    return planPlatformBaseline(
      {
        paths: revision.files.map((file) => file.path),
        read: (path) => this.revisions.readRevisionFileText(workspaceId, revisionId, path),
      },
      mode,
    );
  }

  /**
   * Materialize the plan as a new revision. Returns the base revision id
   * unchanged when nothing had to be written, or when the plan is blocked.
   */
  async applyBaseline(input: {
    workspaceId: string;
    baseRevisionId: string;
    newRevisionId: string;
    mode: BaselineMode;
  }): Promise<{ revisionId: string; plan: PlatformBaselinePlan }> {
    const plan = await this.planBaseline({
      workspaceId: input.workspaceId,
      revisionId: input.baseRevisionId,
      mode: input.mode,
    });

    if (plan.violations.length || !plan.files.length) {
      return { revisionId: input.baseRevisionId, plan };
    }

    const revision = await this.revisions.patchRevisionWithFiles({
      workspaceId: input.workspaceId,
      baseRevisionId: input.baseRevisionId,
      newRevisionId: input.newRevisionId,
      additionalFiles: plan.files,
    });

    this.logger.log(
      `Applied platform baseline mode=${input.mode} workspaceId=${input.workspaceId} ` +
        `base=${input.baseRevisionId} new=${revision.revisionId} files=${plan.files.length}`,
    );

    return { revisionId: revision.revisionId, plan };
  }
}

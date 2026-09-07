import { Injectable } from '@nestjs/common';

@Injectable()
/**
 * Normalizes Playbook workspace selection to the supported optional default.
 */
export class FlowWorkspacePolicyService {
  normalizeWorkspaces(workspaces?: string[]): string[] {
    return workspaces
      ?.map((workspaceId) => workspaceId.trim())
      .filter((workspaceId) => workspaceId.length > 0)
      .slice(0, 1)
      ?? [];
  }
}

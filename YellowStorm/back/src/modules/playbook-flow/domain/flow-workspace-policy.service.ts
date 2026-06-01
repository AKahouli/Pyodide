import { Injectable } from '@nestjs/common';

import { ErrorCode } from '../../exceptions/constants/error-codes';
import { BadRequestException } from '../../exceptions/exceptions/http.exceptions';

@Injectable()
/**
 * Owns workspace-selection rules for playbook flows, including normalization to
 * the supported default workspace shape and validation before persistence.
 */
export class FlowWorkspacePolicyService {
  normalizeWorkspaces(workspaces?: string[]): string[] {
    return workspaces
      ?.map((workspaceId) => workspaceId.trim())
      .filter((workspaceId) => workspaceId.length > 0)
      .slice(0, 1)
      ?? [];
  }

  ensureWorkspaceSelection(workspaces: string[]): void {
    if (workspaces.length === 0) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Select a default playbook workspace before saving this playbook.',
      );
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateGovernanceSourceVersionDto } from '../dto/create-governance-source-version.dto';
import type { GovernanceSourceType } from '../schemas/governance-source.schema';
import type { GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';

export interface WorkspaceSourceInput {
  workspaceId: string;
  documentId: string;
  documentType: 'doc' | 'url';
  originalName: string;
  sourceUrl?: string;
  normalizedSourceUrl?: string;
  contentHash?: string;
}

export interface GovernanceSourceFromWorkspaceCommand {
  originKey: string;
  source: Record<string, unknown>;
  version: CreateGovernanceSourceVersionDto;
}

@Injectable()
export class GovernanceSourceFromWorkspaceFactory {
  build(binding: GovernanceWorkspaceBindingDocument, input: WorkspaceSourceInput): GovernanceSourceFromWorkspaceCommand {
    const defaults = binding.defaults ?? {};
    const sourceType = this.sourceType(defaults.sourceType, input.documentType);
    const ownerScopeId = defaults.ownerScopeId ? new Types.ObjectId(defaults.ownerScopeId) : binding.scopeIds[0];
    const originKey = input.documentType === 'url' && input.normalizedSourceUrl
      ? `canonical-url:${input.normalizedSourceUrl}`
      : `workspace-document:${input.workspaceId}:${input.documentId}`;
    const validityMode = defaults.validityMode ?? 'unknown';

    return {
      originKey,
      source: {
        programId: binding.programId,
        scopeIds: binding.scopeIds,
        visibility: binding.visibility,
        title: input.originalName,
        sourceType,
        url: input.sourceUrl,
        workspaceId: new Types.ObjectId(input.workspaceId),
        documentId: new Types.ObjectId(input.documentId),
        originKey,
        ownerUserId: defaults.ownerUserId ? new Types.ObjectId(defaults.ownerUserId) : undefined,
        ownerScopeId,
        reviewFrequencyDays: defaults.reviewFrequencyDays,
      },
      version: {
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        canonicalUrl: input.normalizedSourceUrl,
        contentHash: input.contentHash,
        extractedMetadata: binding.ingestionMode === 'assisted' ? { ingestionRequiresConfirmation: true } : {},
        initialValidity: { mode: validityMode, reviewFrequencyDays: defaults.reviewFrequencyDays },
      },
    };
  }

  private sourceType(configured: string | undefined, documentType: WorkspaceSourceInput['documentType']): GovernanceSourceType {
    const valid: GovernanceSourceType[] = ['pdf', 'web_page', 'api', 'manual_record', 'spreadsheet'];
    return configured && valid.includes(configured as GovernanceSourceType)
      ? configured as GovernanceSourceType
      : documentType === 'url' ? 'web_page' : 'pdf';
  }
}

import { Injectable } from '@nestjs/common';
import type {
  RunCodeAttachmentSource,
  RunCodeSourceDescriptor,
  RunCodeWorkspaceMetadata,
} from '../interfaces/run-code-source.interface';
import { WorkspaceService } from '../workspace.service';

@Injectable()
export class RunCodeSourceScopeService {
  constructor(private readonly workspaceService: WorkspaceService) {}

  async buildSources(
    workspaceIds: string[],
    attachments: RunCodeAttachmentSource[],
  ): Promise<RunCodeSourceDescriptor[]> {
    const orderedIds = [...new Set([
      ...workspaceIds.filter(Boolean),
      ...attachments.map((attachment) => attachment.workspaceId).filter(Boolean),
    ])];
    const metadata = await this.workspaceService.getRunCodeSourceMetadataByIds(orderedIds);
    const aliases = this.stableAliases(metadata);
    const fullScope = new Set(workspaceIds);
    const attachmentPaths = new Map<string, Map<string, Set<string>>>();

    for (const attachment of attachments) {
      const workspace = metadata[attachment.workspaceId];
      if (!workspace) continue;
      const path = attachment.path.trim().replace(/^\/+|\/+$/g, '');
      const canonicalPrefix = workspace.cephPrefix;
      const canonicalPathPrefix = `${canonicalPrefix}/`;
      let sourcePrefix = canonicalPrefix;
      let relativePath = '';

      if (path.startsWith(canonicalPathPrefix)) {
        if (fullScope.has(attachment.workspaceId)) continue;
        relativePath = path.slice(canonicalPathPrefix.length);
      } else {
        const pathParts = path.split('/');
        const canonicalParts = canonicalPrefix.split('/');
        const owner = canonicalParts[0];
        const storagePrefix = canonicalParts.at(-1) ?? '';
        const legacyConversationPrefix = storagePrefix.startsWith('system-')
          ? storagePrefix.slice('system-'.length)
          : '';
        if (
          !legacyConversationPrefix
          || pathParts.length < 3
          || pathParts[0] !== owner
          || pathParts[1] !== legacyConversationPrefix
        ) continue;
        sourcePrefix = `${owner}/${legacyConversationPrefix}`;
        relativePath = pathParts.slice(2).join('/');
      }
      if (!this.isSafeRelativePath(relativePath)) continue;
      const roots = attachmentPaths.get(attachment.workspaceId) ?? new Map<string, Set<string>>();
      const paths = roots.get(sourcePrefix) ?? new Set<string>();
      paths.add(relativePath);
      roots.set(sourcePrefix, paths);
      attachmentPaths.set(attachment.workspaceId, roots);
    }

    const sources: RunCodeSourceDescriptor[] = [];
    for (const workspaceId of orderedIds) {
      const workspace = metadata[workspaceId];
      if (!workspace) continue;
      if (fullScope.has(workspaceId)) {
        sources.push({
          workspaceId,
          alias: aliases[workspaceId],
          cephPrefix: workspace.cephPrefix,
          scope: { kind: 'workspace' },
        });
      }
      const roots = [...(attachmentPaths.get(workspaceId) ?? new Map<string, Set<string>>())]
        .sort(([left], [right]) => left.localeCompare(right));
      roots.forEach(([cephPrefix, paths], index) => {
        const useWorkspaceAlias = !fullScope.has(workspaceId)
          && roots.length === 1
          && cephPrefix === workspace.cephPrefix;
        sources.push({
          workspaceId,
          alias: useWorkspaceAlias
            ? aliases[workspaceId]
            : this.normalizeAlias(`${aliases[workspaceId]}-attachment${index ? `-${index + 1}` : ''}`),
          cephPrefix,
          scope: { kind: 'files', relativePaths: [...paths].sort() },
        });
      });
    }
    return sources;
  }

  private stableAliases(
    metadata: Record<string, RunCodeWorkspaceMetadata>,
  ): Record<string, string> {
    const grouped = new Map<string, string[]>();
    for (const workspace of Object.values(metadata)) {
      const base = this.normalizeAlias(workspace.alias || workspace.name || workspace.workspaceId);
      grouped.set(base, [...(grouped.get(base) ?? []), workspace.workspaceId].sort());
    }
    const aliases: Record<string, string> = {};
    for (const [base, ids] of grouped) {
      ids.forEach((id, index) => {
        if (index === 0) aliases[id] = base;
        else {
          const suffix = id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(-4) || String(index + 1);
          aliases[id] = `${base.slice(0, 59)}-${suffix}`;
        }
      });
    }
    return aliases;
  }

  private normalizeAlias(value: string): string {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'source';
  }

  private isSafeRelativePath(value: string): boolean {
    return !!value && !value.includes('\\') && value.split('/').every((part) => !!part && part !== '.' && part !== '..');
  }
}

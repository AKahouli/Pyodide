import { RunCodeSourceScopeService } from './run-code-source-scope.service';
import type { WorkspaceService } from '../workspace.service';

describe('RunCodeSourceScopeService', () => {
  const metadata = {
    'workspace-a82f': {
      workspaceId: 'workspace-a82f', name: 'Finance Europe', alias: 'finance',
      cephPrefix: 'owner-a/immutable-finance',
    },
    'workspace-b91c': {
      workspaceId: 'workspace-b91c', name: 'Finance US', alias: 'finance',
      cephPrefix: 'owner-b/immutable-finance',
    },
    'workspace-system': {
      workspaceId: 'workspace-system', name: 'Conversation files', alias: 'conversation-files',
      cephPrefix: 'owner-a/system-conversation-123',
    },
  };

  function service(): RunCodeSourceScopeService {
    return new RunCodeSourceScopeService({
      getRunCodeSourceMetadataByIds: jest.fn().mockResolvedValue(metadata),
    } as unknown as WorkspaceService);
  }

  it('builds deterministic aliases independent of input order', async () => {
    const first = await service().buildSources(['workspace-b91c', 'workspace-a82f'], []);
    const second = await service().buildSources(['workspace-a82f', 'workspace-b91c'], []);
    const aliases = (sources: typeof first) => Object.fromEntries(sources.map((source) => [source.workspaceId, source.alias]));
    expect(aliases(first)).toEqual(aliases(second));
    expect(aliases(first)).toEqual({ 'workspace-a82f': 'finance', 'workspace-b91c': 'finance-b91c' });
  });

  it('limits attachment-only sources to exact relative paths', async () => {
    const sources = await service().buildSources([], [
      { workspaceId: 'workspace-a82f', path: 'owner-a/immutable-finance/contracts/supplier.pdf' },
      { workspaceId: 'workspace-a82f', path: 'owner-a/immutable-finance/contracts/supplier.pdf' },
      { workspaceId: 'workspace-a82f', path: 'owner-a/other/private.pdf' },
    ]);
    expect(sources).toEqual([{
      workspaceId: 'workspace-a82f', alias: 'finance', cephPrefix: 'owner-a/immutable-finance',
      scope: { kind: 'files', relativePaths: ['contracts/supplier.pdf'] },
    }]);
  });

  it('keeps selected workspaces at full scope even when a file is attached', async () => {
    const sources = await service().buildSources(['workspace-a82f'], [{
      workspaceId: 'workspace-a82f', path: 'owner-a/immutable-finance/report.pdf',
    }]);
    expect(sources[0]?.scope).toEqual({ kind: 'workspace' });
  });

  it('exactly scopes legacy conversation attachments stored outside the system workspace prefix', async () => {
    const sources = await service().buildSources([], [{
      workspaceId: 'workspace-system', path: 'owner-a/conversation-123/deatils.txt',
    }]);

    expect(sources).toEqual([{
      workspaceId: 'workspace-system',
      alias: 'conversation-files-attachment',
      cephPrefix: 'owner-a/conversation-123',
      scope: { kind: 'files', relativePaths: ['deatils.txt'] },
    }]);
  });

  it('keeps a legacy exact attachment alongside a selected full workspace', async () => {
    const sources = await service().buildSources(['workspace-system'], [{
      workspaceId: 'workspace-system', path: 'owner-a/conversation-123/deatils.txt',
    }]);

    expect(sources).toEqual([
      {
        workspaceId: 'workspace-system', alias: 'conversation-files', cephPrefix: 'owner-a/system-conversation-123',
        scope: { kind: 'workspace' },
      },
      {
        workspaceId: 'workspace-system', alias: 'conversation-files-attachment', cephPrefix: 'owner-a/conversation-123',
        scope: { kind: 'files', relativePaths: ['deatils.txt'] },
      },
    ]);
  });

  it('rejects legacy system-workspace attachments from another owner or conversation root', async () => {
    const sources = await service().buildSources([], [
      { workspaceId: 'workspace-system', path: 'owner-b/conversation-123/private.txt' },
      { workspaceId: 'workspace-system', path: 'owner-a/conversation-999/private.txt' },
    ]);

    expect(sources).toEqual([]);
  });
});

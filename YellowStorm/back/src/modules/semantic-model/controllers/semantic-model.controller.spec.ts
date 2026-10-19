import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ForbiddenException } from '@modules/exceptions';
import { SemanticModelController } from './semantic-model.controller';
import { SemanticSourceAccessService } from '../services/semantic-source-access.service';
import { SemanticSourceMappingService } from '../services/semantic-source-mapping.service';

jest.mock('@modules/authorization', () => ({
  Permissions: new Proxy({}, { get: (_target, property) => String(property) }),
  PermissionsGuard: class PermissionsGuard { },
  RequirePermissions: () => () => undefined,
}));

describe('SemanticModelController validation synchronization', () => {
  // P1.6: validation is read-only; explicit Prepare/Refresh rebuilds the graph.
  it('validates without rebuilding the graph', async () => {
    const graph = { validate: jest.fn().mockResolvedValue({ issues: [] }) };
    const controller = new SemanticModelController(
      {} as never,
      graph as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.validate({ _id: { toString: () => 'user-id' } } as never, 'model-id'))
      .resolves.toEqual({ issues: [] });

    expect(graph.validate).toHaveBeenCalledWith('user-id', 'model-id');
  });
});

describe('SemanticModelController graph search', () => {
  it('passes the person, model and request to the graph search service', async () => {
    const graphSearch = {
      search: jest.fn().mockResolvedValue({ status: 'found' }),
      expand: jest.fn().mockResolvedValue({ status: 'found' }),
      indexStatus: jest.fn().mockResolvedValue({ index: { state: 'ready' } }),
      ensureIndex: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
      stopIndex: jest.fn().mockResolvedValue({ stopped: true }),
      restartIndex: jest.fn().mockResolvedValue({ restarted: true }),
    };
    const unused = {} as never;
    const controller = new SemanticModelController(
      unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, graphSearch as never, unused, unused, unused,
    );
    const user = { _id: { toString: () => 'user-id' } } as never;

    await controller.search(user, 'model-id', { environment: 'production', query: 'acme' } as never);
    await controller.expandSearch(user, 'model-id', { environment: 'draft', seedEntityIds: ['e-1'], steps: [{}] } as never);
    await controller.searchIndex(user, 'model-id', { environment: 'production' } as never);
    await controller.ensureSearchIndex(user, 'model-id', { environment: 'draft', expectedDataRevisionId: 'dr-1', expectedIndexId: 'ix-1' } as never);
    await controller.stopSearchIndex(user, 'model-id', { environment: 'draft' } as never);
    await controller.restartSearchIndex(user, 'model-id', { environment: 'draft' } as never);

    expect(graphSearch.search).toHaveBeenCalledWith('user-id', 'model-id', { environment: 'production', query: 'acme' });
    expect(graphSearch.expand).toHaveBeenCalledWith('user-id', 'model-id', { environment: 'draft', seedEntityIds: ['e-1'], steps: [{}] });
    expect(graphSearch.indexStatus).toHaveBeenCalledWith('user-id', 'model-id', 'production');
    expect(graphSearch.ensureIndex).toHaveBeenCalledWith('user-id', 'model-id', 'draft', { expectedDataRevisionId: 'dr-1', expectedIndexId: 'ix-1' });
    expect(graphSearch.stopIndex).toHaveBeenCalledWith('user-id', 'model-id', 'draft');
    expect(graphSearch.restartIndex).toHaveBeenCalledWith('user-id', 'model-id', 'draft');
  });
});

describe('SemanticModelController model check', () => {
  it('passes the person and model to the check service', async () => {
    const modelCheck = { check: jest.fn().mockResolvedValue({ errorCount: 0, issues: [] }) };
    const unused = {} as never;
    const controller = new SemanticModelController(
      unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, modelCheck as never, unused,
    );

    await expect(controller.check({ _id: { toString: () => 'user-id' } } as never, 'model-id')).resolves.toEqual({ errorCount: 0, issues: [] });
    expect(modelCheck.check).toHaveBeenCalledWith('user-id', 'model-id');
  });
});

describe('SemanticModelController model health', () => {
  it('passes the person and model to the health service', async () => {
    const modelHealth = { health: jest.fn().mockResolvedValue({ state: 'ready', concepts: [] }) };
    const unused = {} as never;
    const controller = new SemanticModelController(
      unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, modelHealth as never,
    );

    await expect(controller.health({ _id: { toString: () => 'user-id' } } as never, 'model-id')).resolves.toEqual({ state: 'ready', concepts: [] });
    expect(modelHealth.health).toHaveBeenCalledWith('user-id', 'model-id');
  });
});

describe('SemanticModelController source authorization (SEC-03/SEC-04 / WP-03)', () => {
  const user = { _id: { toString: () => 'user-id' } } as never;

  function buildController(hasAccess: boolean) {
    const database = { query: jest.fn(async (sql: string) => {
      if (sql.includes('workspace_id=$2')) return { rows: [{ 1: 1 }] };
      if (sql.includes('FROM semantic_model.workspace_links')) {
        return { rows: [{ workspaceId: 'ws-allowed' }, { workspaceId: 'ws-private' }] };
      }
      if (sql.includes("role='origin'")) return { rows: [{ workspaceId: 'ws-allowed' }] };
      if (sql.includes('FROM semantic_datasource.discovery_profiles')) return { rows: [] };
      return { rows: [] };
    }) };
    const workspaceShares = {
      hasAccess: jest.fn().mockResolvedValue(hasAccess),
      filterAccessible: jest.fn().mockResolvedValue(hasAccess ? ['ws-allowed', 'ws-private'] : ['ws-allowed']),
    };
    const access = new SemanticSourceAccessService(database as never, workspaceShares as never);
    const models = {
      // Role checks like the real service: 'user-id' is a viewer, 'editor-id' an editor.
      requireRole: jest.fn(async (userId: string, _model: string, roles: string[]) => {
        const role = userId === 'editor-id' ? 'editor' : 'viewer';
        if (!roles.includes(role)) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED);
        return { id: 'model-1', currentDraftVersionId: 'v-1', role };
      }),
      requireActiveRole: jest.fn(async (userId: string, _model: string, roles: string[]) => {
        const role = userId === 'editor-id' ? 'editor' : 'viewer';
        if (!roles.includes(role)) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED);
        return { id: 'model-1', currentDraftVersionId: 'v-1', role };
      }),
    };
    const sourceMappings = new SemanticSourceMappingService(
      database as never,
      models as never,
      { findById: jest.fn().mockResolvedValue({ id: 'doc-1', workspaceId: 'ws-allowed', mimeType: 'text/csv', originalName: 'sales.csv', size: 4, indexingStatus: 'ready' }) } as never,
      { requestDatasourceDiscovery: jest.fn().mockResolvedValue({ jobId: 'job-1' }) } as never,
      { preview: jest.fn() } as never,
      access,
    );
    const unused = {} as never;
    const controller = new SemanticModelController(
      unused, unused, unused, unused, unused, unused, sourceMappings as never, unused, unused, unused, unused, unused, unused, unused, unused, unused,
    );
    return { controller, workspaceShares };
  }

  it('denies a profile read for a workspace the person cannot access, non-enumerating', async () => {
    const { controller, workspaceShares } = buildController(false);

    await expect(controller.profileSourceAsset(user, 'model-id', 'private-doc', { workspaceId: 'ws-private' } as never))
      .rejects.toMatchObject({ status: 403, code: ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID });
    expect(workspaceShares.hasAccess).toHaveBeenCalledWith('user-id', 'ws-private');
  });

  it('refuses profile generation from a viewer at the API boundary (WP03.4 role policy)', async () => {
    const { controller } = buildController(true);

    await expect(controller.requestSourceAssetProfile(user, 'model-id', 'doc-1', { workspaceId: 'ws-allowed' } as never))
      .rejects.toMatchObject({ status: 403 });
  });

  it('accepts a profile request from an editor on a workspace they can read', async () => {
    const { controller } = buildController(true);
    const editor = { _id: { toString: () => 'editor-id' } } as never;

    await expect(controller.requestSourceAssetProfile(editor, 'model-id', 'doc-1', { workspaceId: 'ws-allowed' } as never))
      .resolves.toMatchObject({ jobId: 'job-1' });
  });
});

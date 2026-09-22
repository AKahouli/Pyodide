import { artifactRowToRecord } from './workspace-artifact-record.mapper';

const at = new Date('2026-09-11T10:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '61a1b2c3d4e5f6a7b8c9d0a1',
    workspaceId: '61a1b2c3d4e5f6a7b8c9d0a2',
    type: 'decision_flow',
    name: 'Flow',
    description: null,
    status: 'ready',
    schemaVersion: 1,
    revision: 3,
    primarySource: { documentId: '61a1b2c3d4e5f6a7b8c9d0a3', documentName: 's.pdf', selection: { mode: 'all' } },
    primarySourceDocumentId: '61a1b2c3d4e5f6a7b8c9d0a3',
    generationOptions: { flowType: 'eligibility' },
    payload: null,
    generationAgentId: '61a1b2c3d4e5f6a7b8c9d0a4',
    generationRequestedBy: '61a1b2c3d4e5f6a7b8c9d0a5',
    generationAttempts: 1,
    generationStartedAt: at,
    generationCompletedAt: at,
    generationError: null,
    generationUsage: { inputTokens: 10, outputTokens: 20, model: 'm' },
    leaseToken: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    clonedFromArtifactId: null,
    createdBy: '61a1b2c3d4e5f6a7b8c9d0a5',
    updatedBy: '61a1b2c3d4e5f6a7b8c9d0a5',
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const toJson = (overrides: Record<string, unknown> = {}) =>
  JSON.parse(JSON.stringify(artifactRowToRecord(row(overrides) as never)));

describe('artifactRowToRecord (public JSON shape)', () => {
  it('exposes exactly the public keys, with id and no _id/__v or flat PG columns', () => {
    const json = toJson();
    expect(Object.keys(json).sort()).toEqual([
      'createdAt',
      'createdBy',
      'generation',
      'generationOptions',
      'id',
      'name',
      'primarySource',
      'revision',
      'schemaVersion',
      'status',
      'type',
      'updatedAt',
      'updatedBy',
      'workspaceId',
    ]);
    expect(json).not.toHaveProperty('_id');
    expect(json).not.toHaveProperty('__v');
    expect(json).not.toHaveProperty('primarySourceDocumentId');
  });

  it('nests generation and primarySource like the Mongo document', () => {
    const json = toJson();
    expect(Object.keys(json.generation).sort()).toEqual([
      'agentId',
      'attempts',
      'completedAt',
      'requestedBy',
      'startedAt',
      'usage',
    ]);
    expect(json.generation.usage).toEqual({ inputTokens: 10, outputTokens: 20, model: 'm' });
    expect(json.primarySource).toEqual({
      documentId: '61a1b2c3d4e5f6a7b8c9d0a3',
      documentName: 's.pdf',
      selection: { mode: 'all' },
    });
  });

  it('includes optional fields only when set', () => {
    const json = toJson({ description: 'd', clonedFromArtifactId: '61a1b2c3d4e5f6a7b8c9d0a9', payload: { nodes: [] } });
    expect(json).toMatchObject({
      description: 'd',
      clonedFromArtifactId: '61a1b2c3d4e5f6a7b8c9d0a9',
      payload: { nodes: [] },
    });
  });
});

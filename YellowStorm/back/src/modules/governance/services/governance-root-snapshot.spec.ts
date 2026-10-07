import { publishedRootWork, sealRootWork } from './governance-root-snapshot';
import { newRootExecutionPolicy } from '@modules/agent/interfaces/root-execution-policy.interface';

describe('Published Root authority seal', () => {
  it('survives storage serialization but rejects client data, pool tampering, revision substitution and key rotation', () => {
    const value = { version: 1 as const, pool: { rootAgentId: 'root', rootSnapshotDigest: 'digest',
      policy: newRootExecutionPolicy(), entries: [] } as never };
    const frozen = sealRootWork(value, 'revision', 'test-secret');
    const stored = JSON.parse(JSON.stringify({ rootWork: frozen }));
    expect(publishedRootWork(stored, 'revision', 'test-secret')).toEqual(frozen);
    expect(() => publishedRootWork({ rootWork: value }, 'revision', 'test-secret')).toThrow();
    expect(() => publishedRootWork(stored, 'other-revision', 'test-secret')).toThrow();
    expect(() => publishedRootWork(stored, 'revision', 'rotated-secret')).toThrow();
    stored.rootWork.pool.policy.background.enabled = true;
    expect(() => publishedRootWork(stored, 'revision', 'test-secret')).toThrow();
    expect(publishedRootWork({})).toBeUndefined();
  });
});

import { ConflictException, ErrorCode } from '@modules/exceptions';
import type { RootDelegatePool } from '@modules/agent/services/root-delegate-resolver.service';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { stableStringify } from '@modules/agent/services/agent-execution-snapshot.service';

export interface PublishedRootWorkV1 { version: 1; pool: RootDelegatePool; serverSeal: string }

export function sealRootWork(value: Omit<PublishedRootWorkV1, 'serverSeal'>, revisionId: string, secret?: string): PublishedRootWorkV1 {
  if (!secret) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
  return { ...value, serverSeal: createHmac('sha256', secret).update(stableStringify({
    purpose: 'governed-root-v1', revisionId, version: value.version, pool: value.pool,
  })).digest('hex') };
}

export function publishedRootWork(snapshot?: Record<string, unknown>, revisionId?: string, secret?: string): PublishedRootWorkV1 | undefined {
  const value = snapshot?.rootWork as PublishedRootWorkV1 | undefined;
  if (value === undefined) return undefined;
  if (value?.version !== 1 || !value.pool?.rootAgentId || !value.pool.rootSnapshotDigest
    || value.pool.policy?.version !== 1 || !Array.isArray(value.pool.entries) || value.pool.entries.length > 64
    || !revisionId || !secret || !/^[a-f0-9]{64}$/.test(value.serverSeal ?? '')) {
    throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
  }
  const expected = sealRootWork(value, revisionId, secret).serverSeal;
  if (!timingSafeEqual(Buffer.from(value.serverSeal, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
  }
  return value;
}

/** Only the publication service may write this reserved revision field. */
export function assertNoClientRootWork(snapshot?: Record<string, unknown>): void {
  if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'rootWork')) {
    throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
  }
}

import { createHash } from 'node:crypto';
import { stableStringify } from '../../agent/services/agent-execution-snapshot.service';

export interface FanoutProposalV1 {
  version: 1;
  mode: 'foreground' | 'background';
  nativeCallId: string;
  nativeCallBranch: string;
  target: { kind: 'library'; agentId: string } | { kind: 'temporary' };
  items: Array<{ key: string; task: string; expectedOutput?: string; contextRefs?: string[] }>;
}

export interface FanoutManifestV1 extends FanoutProposalV1 {
  manifestId: string;
  digest: string;
  items: Array<FanoutProposalV1['items'][number] & { executionId: string; nativeRunId: string;
    nativeCallBranch: string; requestDigest: string }>;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const plainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Validate the entire finite proposal before reserving or starting any item. */
export function buildFanoutManifest(parentId: string, value: unknown, maxItems: number,
  allowedWorkspaceIds: readonly string[], allowBackground = false): FanoutManifestV1 {
  if (!/^[0-9a-f]{24}$/.test(parentId) || !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 50
    || !plainObject(value) || !exactKeys(value, ['version', 'mode', 'nativeCallId', 'nativeCallBranch', 'target', 'items'])
    || value.version !== 1 || !(value.mode === 'foreground' || allowBackground && value.mode === 'background')
    || !boundedText(value.nativeCallId, 256) || !boundedText(value.nativeCallBranch, 2048)
    || !value.nativeCallBranch.endsWith(`run_fanout@${value.nativeCallId}`)) {
    throw new Error('Invalid foreground fan-out proposal');
  }
  const target = value.target;
  if (!plainObject(target) || !(target.kind === 'temporary' && exactKeys(target, ['kind'])
    || target.kind === 'library' && exactKeys(target, ['kind', 'agentId'])
      && typeof target.agentId === 'string' && /^[0-9a-f]{24}$/.test(target.agentId))) {
    throw new Error('Invalid fan-out target');
  }
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > maxItems
    || Buffer.byteLength(stableStringify(value), 'utf8') > 262144) {
    throw new Error('Fan-out finite item or payload limit exceeded');
  }
  const keys = new Set<string>();
  const items = value.items.map((item) => {
    if (!plainObject(item) || !exactKeys(item, ['key', 'task', 'expectedOutput', 'contextRefs'])
      || typeof item.key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.key)
      || keys.has(item.key) || !boundedText(item.task, 50000)
      || item.expectedOutput !== undefined && (typeof item.expectedOutput !== 'string' || item.expectedOutput.length > 2000)) {
      throw new Error('Invalid or duplicate fan-out item');
    }
    keys.add(item.key);
    const refs = item.contextRefs ?? [];
    if (!Array.isArray(refs) || refs.length > 20 || new Set(refs).size !== refs.length
      || refs.some((ref) => typeof ref !== 'string' || !allowedWorkspaceIds.includes(ref))) {
      throw new Error('Fan-out input reference is not authorized');
    }
    return { key: item.key, task: item.task,
      ...(item.expectedOutput === undefined ? {} : { expectedOutput: item.expectedOutput as string }), contextRefs: [...refs] as string[] };
  });
  const proposal: FanoutProposalV1 = { version: 1, mode: value.mode, nativeCallId: value.nativeCallId,
    nativeCallBranch: value.nativeCallBranch, target: { ...target } as FanoutProposalV1['target'], items };
  const manifestId = hash(`${parentId}:${proposal.nativeCallBranch}`).slice(0, 24);
  return { ...proposal, manifestId, digest: hash(stableStringify(proposal)), items: items.map((item) => {
    const identity = hash(`${manifestId}:${item.key}`);
    const nativeRunId = `item_${identity}`;
    const tool = proposal.target.kind === 'library' ? 'delegate_to_agent' : 'spawn_temporary_worker';
    const nativeCallBranch = `${proposal.nativeCallBranch}.${nativeRunId}.${tool}@${nativeRunId}`;
    const request = { task: item.task, expectedOutput: item.expectedOutput ?? '', contextRefs: item.contextRefs ?? [],
      ...(proposal.target.kind === 'library' ? { agentId: proposal.target.agentId }
        : { nativeCallId: nativeRunId, nativeCallBranch }) };
    return { ...item, executionId: hash(`${parentId}:${nativeCallBranch}`).slice(0, 24), nativeRunId,
      nativeCallBranch, requestDigest: hash(stableStringify(request)) };
  }) };
}

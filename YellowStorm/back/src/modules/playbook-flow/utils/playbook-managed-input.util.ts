import { createHash } from 'crypto';
import type { ControlEdge, DataBinding, FlowNode } from '../models/playbook-flow.model';

export const MANAGED_PLAYBOOK_INPUT_PREFIX = 'playbookInputs.';
export const MAX_MANAGED_TRIGGER_PATH_LENGTH = 200;

const MANAGED_INPUT_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/;
const PROTOTYPE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isManagedPlaybookInputPath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > MAX_MANAGED_TRIGGER_PATH_LENGTH) return false;
  if (!value.startsWith(MANAGED_PLAYBOOK_INPUT_PREFIX)) return false;
  const key = value.slice(MANAGED_PLAYBOOK_INPUT_PREFIX.length);
  return MANAGED_INPUT_KEY_PATTERN.test(key) && !PROTOTYPE_SEGMENTS.has(key);
}

export function isCompleteDataBinding(binding: DataBinding): boolean {
  switch (binding.sourceKind) {
    case 'node-output':
      return isNonEmptyString(binding.sourceNode) && isNonEmptyString(binding.sourcePort);
    case 'trigger':
      return isNonEmptyString(binding.triggerPath)
        && (!binding.triggerPath.startsWith(MANAGED_PLAYBOOK_INPUT_PREFIX) || isManagedPlaybookInputPath(binding.triggerPath));
    case 'state':
      return isNonEmptyString(binding.statePath);
    case 'expression':
      return isNonEmptyString(binding.expression);
    case 'constant':
      return Object.prototype.hasOwnProperty.call(binding, 'constantValue') && binding.constantValue !== undefined;
    default:
      return false;
  }
}

export function isRouterControlInput(
  nodeId: string,
  portId: string,
  nodes: FlowNode[],
  edges: ControlEdge[],
): boolean {
  const routerIds = new Set(nodes.filter((node) => node.kind === 'router').map((node) => node.id));
  return edges.some((edge) => edge.kind === 'conditional'
    && routerIds.has(edge.source)
    && edge.target === nodeId
    && (edge.targetInputPortId || 'default') === portId);
}

export function readOwnPath(root: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (PROTOTYPE_SEGMENTS.has(segment) || !current || typeof current !== 'object') return { found: false };
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return { found: false };
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

export function hasRequiredInputValue(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim().length === 0);
}

export function createManagedPlaybookInputPath(
  nodeIdentity: string,
  portId: string,
  usedPaths: Set<string>,
): string {
  const rawIdentity = `${nodeIdentity}__${portId}`;
  const sanitized = rawIdentity
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'input';
  let key = sanitized;
  let path = `${MANAGED_PLAYBOOK_INPUT_PREFIX}${key}`;
  if (usedPaths.has(path)) {
    const suffix = createHash('sha256').update(rawIdentity).digest('hex').slice(0, 8);
    key = `${sanitized.slice(0, 111)}_${suffix}`;
    path = `${MANAGED_PLAYBOOK_INPUT_PREFIX}${key}`;
  }
  usedPaths.add(path);
  return path;
}

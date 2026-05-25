export const NODE_KINDS = ['step', 'router', 'iterator', 'human_approval'] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export type DecisionFlowNodeType = 'start' | 'information' | 'decision' | 'result' | 'end';

export interface DecisionFlowSourceReference { page: number; passage: string; }
export interface DecisionFlowNode { id: string; type: DecisionFlowNodeType; label: string; description?: string; position?: { x: number; y: number }; sourceRefs?: DecisionFlowSourceReference[]; needsConfirmation?: boolean; uncertaintyReason?: string; }
export interface DecisionFlowEdge { id: string; source: string; target: string; label?: string; }
export interface DecisionFlowPayload { title: string; description?: string; nodes: DecisionFlowNode[]; edges: DecisionFlowEdge[]; warnings?: string[]; }

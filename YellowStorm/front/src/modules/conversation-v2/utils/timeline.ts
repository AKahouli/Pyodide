import type { AgentEvent } from '../types';

type MessageEvent = Extract<AgentEvent, { type: 'message' }>;
type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;
type StepEvent = Extract<AgentEvent, { type: 'step' }>;
type PlanEvent = Extract<AgentEvent, { type: 'plan' }>;

export type TimelineNode =
  | { kind: 'message'; key: string; event: MessageEvent }
  | { kind: 'tool'; key: string; event: ToolEvent }
  | { kind: 'step'; key: string; step: StepEvent; tools: ToolEvent[] };

export interface Timeline {
  nodes: TimelineNode[];
  /** The latest plan event, if any — rendered as a floating progress card, not inline. */
  latestPlan: PlanEvent | null;
}

/**
 * Reshape the flat event stream into a Manus-style timeline: tools that land
 * while a step is running are nested under that step (one row per
 * tool_call_id, latest status). A plan is surfaced separately so the UI can
 * render it as a floating progress card.
 */
export function buildTimeline(events: AgentEvent[]): Timeline {
  const nodes: TimelineNode[] = [];
  let latestPlan: PlanEvent | null = null;

  // Index of the currently-open (running) step in `nodes`, or -1.
  let openStepIdx = -1;
  // Map tool_call_id → location { stepIdx | -1 for top-level, toolIdx within that bucket }
  const toolLocation = new Map<string, { stepIdx: number; toolIdx: number; topIdx: number }>();

  for (const ev of events) {
    if (ev.type === 'title' || ev.type === 'wait' || ev.type === 'done' || ev.type === 'error') {
      continue;
    }

    if (ev.type === 'plan') {
      latestPlan = ev;
      continue;
    }

    if (ev.type === 'message') {
      // A new user prompt starts a fresh turn — close any step that the
      // previous turn left open so the new turn's tools never nest into it.
      if (ev.role === 'user') openStepIdx = -1;
      nodes.push({ kind: 'message', key: ev.event_id, event: ev });
      continue;
    }

    if (ev.type === 'step') {
      if (ev.status === 'running' || ev.status === 'pending') {
        nodes.push({ kind: 'step', key: `step:${ev.event_id}`, step: ev, tools: [] });
        openStepIdx = nodes.length - 1;
      } else {
        // completed / failed → close the most recent step with this id and
        // mark openStepIdx clear if it matched.
        const idx = nodes.findLastIndex((n) => n.kind === 'step' && n.step.id === ev.id);
        if (idx >= 0) {
          const node = nodes[idx];
          if (node.kind === 'step') node.step = ev;
        }
        if (openStepIdx >= 0 && nodes[openStepIdx]?.kind === 'step') {
          const open = nodes[openStepIdx];
          if (open.kind === 'step' && open.step.id === ev.id) openStepIdx = -1;
        }
      }
      continue;
    }

    if (ev.type === 'tool') {
      const existing = toolLocation.get(ev.tool_call_id);
      if (existing) {
        // Update in place.
        if (existing.stepIdx >= 0) {
          const node = nodes[existing.stepIdx];
          if (node.kind === 'step') node.tools[existing.toolIdx] = ev;
        } else {
          const node = nodes[existing.topIdx];
          if (node.kind === 'tool') (node as { event: ToolEvent }).event = ev;
        }
      } else if (openStepIdx >= 0 && nodes[openStepIdx]?.kind === 'step') {
        const node = nodes[openStepIdx];
        if (node.kind === 'step') {
          node.tools.push(ev);
          toolLocation.set(ev.tool_call_id, {
            stepIdx: openStepIdx,
            toolIdx: node.tools.length - 1,
            topIdx: -1,
          });
        }
      } else {
        nodes.push({ kind: 'tool', key: `tool:${ev.tool_call_id}`, event: ev });
        toolLocation.set(ev.tool_call_id, {
          stepIdx: -1,
          toolIdx: -1,
          topIdx: nodes.length - 1,
        });
      }
      continue;
    }
  }

  return { nodes, latestPlan };
}

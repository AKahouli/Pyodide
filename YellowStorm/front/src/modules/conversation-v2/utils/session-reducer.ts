import type { AgentEvent, AppBuildProgress } from '../types';
import type { ApplicationComponentState, SessionSlice } from '../store';

export function emptySlice(): SessionSlice {
  return {
    events: [],
    lastSequence: 0,
    liveToolCallId: null,
    liveAssistantIds: new Set<string>(),
    title: null,
    streaming: true,
    streamError: null,
    rightPanelMode: 'closed',
    applicationComponent: null,
    appBuildProgress: null,
    filesSheetOpen: false,
    systemWorkspaceId: null,
    workspaceIds: [],
    deployStatus: 'idle',
    deployedUrl: null,
    lastDeployedAt: null,
    appViewMode: 'nodepod',
    selectedToolCallId: null,
    selectedConnectorRepo: null,
    selectedSkillIds: [],
    selectedConnectorIds: [],
  };
}

export function reduceSession(slice: SessionSlice, event: AgentEvent): SessionSlice {
  const incomingSeq = (event as { sequence?: number }).sequence;
  if (typeof incomingSeq === 'number' && incomingSeq <= slice.lastSequence) {
    return slice;
  }
  const lastSequence =
    typeof incomingSeq === 'number'
      ? Math.max(slice.lastSequence, incomingSeq)
      : slice.lastSequence;
  const base: SessionSlice = { ...slice, lastSequence };

  switch (event.type) {
    case 'title':
      return { ...base, title: event.title };
    case 'done':
      return { ...base, streaming: false, liveToolCallId: null };
    case 'error':
      return { ...base, streamError: event.error, streaming: false, liveToolCallId: null };
    case 'tool': {
      const turnStart = currentTurnStartIndex(slice.events);
      const idx = findIndexFrom(
        slice.events,
        turnStart,
        (e) => e.type === 'tool' && e.tool_call_id === event.tool_call_id,
      );
      const isMessageTool = (event.name || '').toLowerCase() === 'message';
      const liveToolCallId = !isMessageTool ? event.tool_call_id : slice.liveToolCallId;
      let events: AgentEvent[];
      if (idx >= 0) {
        events = slice.events.slice();
        events[idx] = event;
      } else {
        events = [...slice.events, event];
      }
      return { ...base, events, liveToolCallId };
    }
    case 'step': {
      const turnStart = currentTurnStartIndex(slice.events);
      const idx = findIndexFrom(
        slice.events,
        turnStart,
        (e) => e.type === 'step' && e.id === event.id,
      );
      let events: AgentEvent[];
      if (idx >= 0) {
        events = slice.events.slice();
        events[idx] = event;
      } else {
        events = [...slice.events, event];
      }
      return { ...base, events };
    }
    case 'plan': {
      const filtered = slice.events.filter((e) => e.type !== 'plan');
      return { ...base, events: [...filtered, event] };
    }
    case 'wait':
      return { ...base, streaming: false, liveToolCallId: null };
    case 'app_build_progress': {
      const progress: AppBuildProgress = {
        phase: event.phase,
        message: event.message,
        revision: event.event_id,
      };
      return {
        ...base,
        events: [...slice.events, event],
        appBuildProgress: progress,
        // New turn progress supersedes the previous Nodepod / deployed preview.
        applicationComponent: null,
        appViewMode: 'nodepod',
        rightPanelMode: 'app',
      };
    }
    case 'application_component': {
      const applicationComponent: ApplicationComponentState = {
        url: event.url,
        title: event.title ?? '',
        cephPath: event.ceph_path,
        filesTree: event.files_tree ?? null,
        fileCount: event.file_count,
        revision: event.event_id,
      };
      return {
        ...base,
        events: [...slice.events, event],
        applicationComponent,
        appBuildProgress: null,
        appViewMode: 'nodepod',
        rightPanelMode: 'app',
      };
    }
    case 'message': {
      const liveAssistantIds =
        event.role === 'assistant'
          ? new Set(slice.liveAssistantIds).add(event.event_id)
          : slice.liveAssistantIds;
      const existingIdx = slice.events.findIndex(
        (e) => e.type === 'message' && e.event_id === event.event_id,
      );
      let events: AgentEvent[];
      if (existingIdx >= 0) {
        events = slice.events.slice();
        events[existingIdx] = event;
      } else {
        events = [...slice.events, event];
      }
      return { ...base, events, liveAssistantIds };
    }
    default:
      return { ...base, events: [...slice.events, event] };
  }
}

export function deriveTitle(events: AgentEvent[]): string | undefined {
  const last = [...events].reverse().find((e) => e.type === 'title');
  return last?.type === 'title' ? last.title : undefined;
}

export function deriveApplicationComponent(
  events: AgentEvent[],
  previous?: ApplicationComponentState | null,
): ApplicationComponentState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'application_component') {
      if (previous && previous.revision === ev.event_id) {
        return previous;
      }
      console.log('[Nodepod] [replay:deriveApplicationComponent]', {
        event_id: ev.event_id,
        url: ev.url,
        title: ev.title,
        ceph_path: ev.ceph_path,
        file_count: ev.file_count,
        hasFilesTree: !!ev.files_tree,
      });
      return {
        url: ev.url,
        title: ev.title ?? '',
        cephPath: ev.ceph_path,
        filesTree: ev.files_tree ?? null,
        fileCount: ev.file_count,
        revision: ev.event_id,
      };
    }
  }
  return null;
}

export function deriveAppBuildProgress(
  events: AgentEvent[],
  previous?: AppBuildProgress | null,
): AppBuildProgress | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'app_build_progress') {
      if (previous && previous.revision === ev.event_id) {
        return previous;
      }
      return {
        phase: ev.phase,
        message: ev.message,
        revision: ev.event_id,
      };
    }
    if (ev.type === 'application_component') {
      return null;
    }
  }
  return null;
}

export function currentTurnStartIndex(events: AgentEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'message' && ev.role === 'user') return i;
  }
  return 0;
}

export function findIndexFrom<T>(arr: T[], start: number, pred: (t: T) => boolean): number {
  for (let i = start; i < arr.length; i++) if (pred(arr[i])) return i;
  return -1;
}

export function dedupeReplayEvents(events: AgentEvent[]): AgentEvent[] {
  let toolIndex = new Map<string, number>();
  let stepIndex = new Map<string, number>();
  let latestPlanIdx: number | null = null;
  const result: AgentEvent[] = [];

  const resetTurn = () => {
    toolIndex = new Map();
    stepIndex = new Map();
    latestPlanIdx = null;
  };

  for (const ev of events) {
    if (ev.type === 'title' || ev.type === 'wait') continue;

    if (ev.type === 'done' || ev.type === 'error') {
      result.push(ev);
      resetTurn();
      continue;
    }

    if (ev.type === 'message') {
      if (ev.role === 'user') resetTurn();
      result.push(ev);
      continue;
    }

    if (ev.type === 'tool') {
      const existing = toolIndex.get(ev.tool_call_id);
      if (existing !== undefined) {
        result[existing] = ev;
      } else {
        toolIndex.set(ev.tool_call_id, result.length);
        result.push(ev);
      }
      continue;
    }

    if (ev.type === 'step') {
      const existing = stepIndex.get(ev.id);
      if (existing !== undefined) {
        result[existing] = ev;
      } else {
        stepIndex.set(ev.id, result.length);
        result.push(ev);
      }
      continue;
    }

    if (ev.type === 'plan') {
      if (latestPlanIdx !== null) {
        result[latestPlanIdx] = ev;
      } else {
        latestPlanIdx = result.length;
        result.push(ev);
      }
      continue;
    }

    result.push(ev);
  }

  return result;
}

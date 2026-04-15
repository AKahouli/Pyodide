/**
 * Playbook SSE Stream Service (Singleton)
 *
 * Shares a single EventSource across browser tabs via BroadcastChannel.
 * One tab is "leader" (owns EventSource), others are "followers" (receive via BC).
 *
 * State recovery after refresh:
 *  - Leader: receives `playbook_connected` from backend with `activeExecutions` payload
 *  - Follower: requests state from leader via BC `state-request` / `state-response`
 *
 * No separate API calls needed — state flows through SSE (leader) or BC (followers).
 */

import { useEffect } from 'react';
import { API_CONFIG, AUTH_STORAGE_KEYS, API_ENDPOINTS } from '@/lib/api/config';
import { usePlaybookStore } from '../store';
import type { PlaybookStepUpdateEvent } from '../types';

// ===== Constants =====

const BC_CHANNEL_NAME = 'ys-playbook-sse';
const LEADER_HEARTBEAT_INTERVAL_MS = 4_000;
const LEADER_TIMEOUT_MS = 10_000;
const ELECTION_DELAY_MAX_MS = 500;
const LEADER_CHECK_WAIT_MS = 200;

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const SSE_HEARTBEAT_TIMEOUT_MS = 30_000;
const STEP_UPDATE_BATCH_MS = 32;

// ===== Tab identity =====

const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ===== Module state =====

type Role = 'idle' | 'candidate' | 'leader' | 'follower';

let role: Role = 'idle';
let eventSource: EventSource | null = null;
let channel: BroadcastChannel | null = null;

let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let sseHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let leaderHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
let leaderWatchTimer: ReturnType<typeof setTimeout> | null = null;
let electionTimer: ReturnType<typeof setTimeout> | null = null;
let stepUpdateFlushTimer: ReturnType<typeof setTimeout> | null = null;

const pendingStepUpdates = new Map<string, PlaybookStepUpdateEvent>();

const SSE_EVENT_TYPES = [
  'playbook_connected',
  'playbook_heartbeat',
  'playbook_execution_start',
  'playbook_step_start',
  'playbook_step_update',
  'playbook_step_complete',
  'playbook_step_judge_started',
  'playbook_step_judge_updated',
  'playbook_step_evaluation_updated',
  'playbook_judge_summary_updated',
  'playbook_advisor_autopilot_updated',
  'playbook_replay_format_guide_updated',
  'playbook_output_format_template_updated',
  'playbook_execution_complete',
  'playbook_execution_error',
  'playbook_interrupt',
  'playbook_shared',
] as const;

// ===== Timer helpers =====

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }) {
  if (ref.current) { clearTimeout(ref.current); ref.current = null; }
}

const reconnectRef = { get current() { return reconnectTimer; }, set current(v) { reconnectTimer = v; } };
const sseHbRef = { get current() { return sseHeartbeatTimer; }, set current(v) { sseHeartbeatTimer = v; } };
const leaderWatchRef = { get current() { return leaderWatchTimer; }, set current(v) { leaderWatchTimer = v; } };
const electionRef = { get current() { return electionTimer; }, set current(v) { electionTimer = v; } };
const stepUpdateFlushRef = { get current() { return stepUpdateFlushTimer; }, set current(v) { stepUpdateFlushTimer = v; } };

// ===== BroadcastChannel messaging =====

function broadcast(msg: Record<string, unknown>) {
  try { channel?.postMessage(msg); } catch { /* channel closed */ }
}

function flushPendingStepUpdates() {
  clearTimer(stepUpdateFlushRef);
  if (pendingStepUpdates.size === 0) return;

  const store = usePlaybookStore.getState();
  const updates = Array.from(pendingStepUpdates.values());
  pendingStepUpdates.clear();

  for (const update of updates) {
    store.onStepUpdate(update);
  }
}

function scheduleStepUpdateFlush() {
  if (stepUpdateFlushTimer) return;
  stepUpdateFlushRef.current = setTimeout(() => {
    flushPendingStepUpdates();
  }, STEP_UPDATE_BATCH_MS);
}

function queueStepUpdate(data: PlaybookStepUpdateEvent) {
  const key = `${data.executionId}:${data.taskId}`;
  const existing = pendingStepUpdates.get(key);

  pendingStepUpdates.set(key, existing
    ? {
        ...existing,
        ...data,
        output: data.output ?? existing.output,
        components: data.components ?? existing.components,
        toolTrace: data.toolTrace ?? existing.toolTrace,
        llmPromptTrace: data.llmPromptTrace ?? existing.llmPromptTrace,
        artifacts: data.artifacts ?? existing.artifacts,
      }
    : data);

  scheduleStepUpdateFlush();
}

// ===== Event handling (shared by leader + follower) =====

function handleSsePayload(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    const { type, data } =
      typeof parsed === 'object' && parsed.type
        ? parsed
        : { type: parsed?.type, data: parsed };

    const eventType = type || '';
    const eventData = data || parsed;
    const store = usePlaybookStore.getState();

    if (eventType !== 'playbook_step_update') {
      flushPendingStepUpdates();
    }

    switch (eventType) {
      case 'playbook_connected':
        reconnectAttempts = 0;
        // Backend includes activeExecutions in the connected event — hydrate immediately
        if (eventData.activeExecutions?.length > 0) {
          store.hydrateActiveExecutions(eventData.activeExecutions);
        }
        break;
      case 'playbook_heartbeat':
        resetSseHeartbeat();
        break;
      case 'playbook_execution_start':
        store.onExecutionStart(eventData);
        break;
      case 'playbook_step_start':
        store.onStepStart(eventData);
        break;
      case 'playbook_step_update':
        queueStepUpdate(eventData);
        break;
      case 'playbook_step_complete':
        store.onStepComplete(eventData);
        break;
      case 'playbook_step_judge_started':
        store.onStepJudgeStarted(eventData);
        break;
      case 'playbook_step_judge_updated':
        store.onStepJudgeUpdated(eventData);
        break;
      case 'playbook_step_evaluation_updated':
        store.onStepEvaluationUpdated(eventData);
        break;
      case 'playbook_judge_summary_updated':
        store.onJudgeSummaryUpdated(eventData);
        break;
      case 'playbook_advisor_autopilot_updated':
        store.onAdvisorAutopilotUpdated(eventData);
        break;
      case 'playbook_replay_format_guide_updated':
        store.onReplayFormatGuideUpdated(eventData);
        break;
      case 'playbook_output_format_template_updated':
        store.onOutputFormatTemplateUpdated(eventData);
        break;
      case 'playbook_execution_complete':
        store.onExecutionComplete(eventData);
        break;
      case 'playbook_execution_error':
        store.onExecutionComplete(eventData);
        break;
      case 'playbook_interrupt':
        store.onInterrupt(eventData);
        break;
      case 'playbook_shared':
        store.fetchPlaybooks();
        break;
    }
  } catch (err) {
    console.warn('[PlaybookSSE] Failed to parse event', err);
  }
}

// ===== SSE heartbeat (leader only — monitors EventSource health) =====

function resetSseHeartbeat() {
  clearTimer(sseHbRef);
  sseHbRef.current = setTimeout(() => {
    if (role !== 'leader') return;
    closeEventSource();
    scheduleReconnect();
  }, SSE_HEARTBEAT_TIMEOUT_MS);
}

// ===== EventSource management (leader only) =====

function closeEventSource() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  clearTimer(sseHbRef);
}

function openEventSource() {
  closeEventSource();

  const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  if (!token) return;

  const url = `${API_CONFIG.baseURL}${API_ENDPOINTS.playbooks.stream}?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);

  es.onmessage = (event: MessageEvent) => {
    handleSsePayload(event.data);
    broadcast({ type: 'sse-event', payload: event.data });
  };

  // Nest SSE emits named events. Browsers do not route those through `onmessage`,
  // so subscribe to the event names explicitly and normalize them back into the
  // existing payload shape the store expects.
  for (const eventType of SSE_EVENT_TYPES) {
    es.addEventListener(eventType, (event: MessageEvent) => {
      const payload = JSON.stringify({
        type: eventType,
        data: typeof event.data === 'string' ? JSON.parse(event.data) : event.data,
      });
      handleSsePayload(payload);
      broadcast({ type: 'sse-event', payload });
    });
  }

  es.onerror = () => {
    closeEventSource();
    scheduleReconnect();
  };

  eventSource = es;
  resetSseHeartbeat();
}

function scheduleReconnect() {
  if (role !== 'leader') return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;

  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempts++;

  clearTimer(reconnectRef);
  reconnectRef.current = setTimeout(() => {
    if (role === 'leader') openEventSource();
  }, delay);
}

// ===== Leader role =====

function becomeLeader() {
  role = 'leader';
  reconnectAttempts = 0;

  stopLeaderWatch();
  clearTimer(electionRef);

  openEventSource();

  stopLeaderHeartbeat();
  leaderHeartbeatInterval = setInterval(() => {
    broadcast({ type: 'leader-heartbeat', tabId: TAB_ID });
  }, LEADER_HEARTBEAT_INTERVAL_MS);
  broadcast({ type: 'leader-heartbeat', tabId: TAB_ID });
}

function stopLeaderHeartbeat() {
  if (leaderHeartbeatInterval) {
    clearInterval(leaderHeartbeatInterval);
    leaderHeartbeatInterval = null;
  }
}

function resignLeader() {
  if (role !== 'leader') return;
  broadcast({ type: 'leader-resigned', tabId: TAB_ID });
  stopLeaderHeartbeat();
  closeEventSource();
  clearTimer(reconnectRef);
  role = 'idle';
}

// ===== Follower role =====

function becomeFollower() {
  role = 'follower';

  closeEventSource();
  clearTimer(reconnectRef);
  stopLeaderHeartbeat();
  clearTimer(electionRef);

  startLeaderWatch();

  // Request current execution state from the leader so we have full
  // progress immediately (covers F5 refresh and newly opened tabs).
  broadcast({ type: 'state-request', tabId: TAB_ID });
}

function startLeaderWatch() {
  stopLeaderWatch();
  leaderWatchRef.current = setTimeout(() => {
    if (role !== 'follower') return;
    startElection();
  }, LEADER_TIMEOUT_MS);
}

function stopLeaderWatch() {
  clearTimer(leaderWatchRef);
}

function resetLeaderWatch() {
  if (role === 'follower') startLeaderWatch();
}

// ===== Election =====

function startElection() {
  role = 'candidate';
  clearTimer(electionRef);

  const delay = Math.random() * ELECTION_DELAY_MAX_MS;
  electionRef.current = setTimeout(() => {
    checkForLeader((found) => {
      if (found) {
        becomeFollower();
      } else {
        becomeLeader();
      }
    });
  }, delay);
}

function checkForLeader(cb: (found: boolean) => void) {
  let found = false;

  const onMsg = (e: MessageEvent) => {
    if (e.data?.type === 'leader-alive' || e.data?.type === 'leader-heartbeat') {
      found = true;
    }
  };

  channel?.addEventListener('message', onMsg);
  broadcast({ type: 'leader-check' });

  setTimeout(() => {
    channel?.removeEventListener('message', onMsg);
    cb(found);
  }, LEADER_CHECK_WAIT_MS);
}

// ===== BroadcastChannel handler =====

function onChannelMessage(e: MessageEvent) {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'leader-check':
      if (role === 'leader') {
        broadcast({ type: 'leader-alive', tabId: TAB_ID });
      }
      break;

    case 'leader-alive':
    case 'leader-heartbeat':
      if (role === 'candidate') {
        becomeFollower();
      } else if (role === 'follower') {
        resetLeaderWatch();
      }
      break;

    case 'leader-resigned':
      if (role === 'follower') {
        startElection();
      }
      break;

    case 'sse-event':
      if (role === 'follower' && msg.payload) {
        handleSsePayload(msg.payload);
      }
      break;

    // --- State sharing: follower asks leader for current execution state ---
    case 'state-request':
      if (role === 'leader') {
        const state = usePlaybookStore.getState();
        const activeExecs = Object.values(state.executionCache).filter(
          (exec) => exec.status === 'running' || exec.status === 'interrupted',
        );
        broadcast({ type: 'state-response', activeExecutions: activeExecs });
      }
      break;

    case 'state-response':
      if (role === 'follower' && Array.isArray(msg.activeExecutions) && msg.activeExecutions.length > 0) {
        usePlaybookStore.getState().hydrateActiveExecutions(msg.activeExecutions);
      }
      break;
  }
}

// ===== Lifecycle =====

function init() {
  if (role !== 'idle') return;

  try {
    channel = new BroadcastChannel(BC_CHANNEL_NAME);
    channel.onmessage = onChannelMessage;
  } catch {
    // BroadcastChannel not supported — direct EventSource, no sharing
    role = 'leader';
    reconnectAttempts = 0;
    openEventSource();
    return;
  }

  role = 'candidate';
  checkForLeader((found) => {
    if (role !== 'candidate') return;
    if (found) {
      becomeFollower();
    } else {
      becomeLeader();
    }
  });
}

function teardown() {
  if (role === 'leader') resignLeader();

  closeEventSource();
  clearTimer(reconnectRef);
  clearTimer(electionRef);
  clearTimer(stepUpdateFlushRef);
  stopLeaderWatch();
  stopLeaderHeartbeat();
  pendingStepUpdates.clear();

  if (channel) {
    channel.onmessage = null;
    channel.close();
    channel = null;
  }

  role = 'idle';
  reconnectAttempts = 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (role === 'leader') {
      try { channel?.postMessage({ type: 'leader-resigned', tabId: TAB_ID }); } catch { /* noop */ }
    }
  });
}

// ===== React hook =====

/** Mount once at app level (RootGuard). Starts/stops the shared SSE lifecycle. */
export function usePlaybookStreamGlobal() {
  useEffect(() => {
    init();
    return () => teardown();
  }, []);
}

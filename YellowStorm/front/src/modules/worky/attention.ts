import type { WorkyCurrentWorkItem, WorkyCurrentWorkStatus } from './executive/executiveModel';

const NEEDS_ATTENTION = new Set<WorkyCurrentWorkStatus>(['needs_input', 'failed', 'blocked']);

export function findNewAttention(
  previous: Map<string, WorkyCurrentWorkStatus> | null,
  items: WorkyCurrentWorkItem[],
): { current: Map<string, WorkyCurrentWorkStatus>; taskId: string | null } {
  const current = new Map(items.map((item) => [item.task.id, item.status]));
  const taskId = previous
    ? items.find((item) => {
      const previousStatus = previous.get(item.task.id);
      return NEEDS_ATTENTION.has(item.status) && (!previousStatus || !NEEDS_ATTENTION.has(previousStatus));
    })?.task.id ?? null
    : null;
  return { current, taskId };
}

export function playAttentionChime(): void {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return;
  const context = new AudioContextConstructor();
  const start = () => {
    if (context.state !== 'running') {
      void context.close();
      return;
    }
    const now = context.currentTime;
    for (const [offset, frequency] of [[0, 784], [0.24, 587]]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.11, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.34);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.35);
    }
    window.setTimeout(() => { void context.close(); }, 750);
  };
  void context.resume().then(start, () => { void context.close(); });
}

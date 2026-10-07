export type RootWorkEvent = { sequence: string; eventId: string; payload: Record<string, unknown> };
export type RootWorkReplay = { epoch: number; cursor: string; events: RootWorkEvent[] };

export function rootWorkActivityText(event: RootWorkEvent): string | undefined {
  const component = event.payload.component;
  if (!component || typeof component !== 'object') return;
  const data = 'data' in component ? component.data : undefined;
  if (!data || typeof data !== 'object') return;
  for (const key of ['summary', 'message', 'title', 'label', 'toolName']) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value.slice(0, 512);
  }
}

/** The durable sequence closes the snapshot/subscription gap across replicas. */
export function appendRootWorkEvents(previous: RootWorkReplay | undefined, epoch: number,
  events: RootWorkEvent[]): RootWorkReplay {
  if (previous && epoch < previous.epoch) return previous;
  const current = previous?.epoch === epoch ? previous : { epoch, cursor: '0', events: [] };
  const accepted = events.filter((event) => /^[0-9]{1,20}$/.test(event.sequence)
    && BigInt(event.sequence) > BigInt(current.cursor) && event.payload.conversationEpoch === epoch)
    .sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0);
  const seen = new Set(current.events.map((event) => event.eventId));
  const unique = accepted.filter((event) => { if (seen.has(event.eventId)) return false; seen.add(event.eventId); return true; });
  return { epoch, cursor: accepted.at(-1)?.sequence ?? current.cursor,
    events: [...current.events, ...unique].slice(-100) };
}

/**
 * Wire compaction for streamed `agentActivity` updates.
 *
 * The ADK resends the cumulative reasoning `detail` (and a `summary` derived
 * from it) on every token, which makes the SSE payload grow quadratically. The
 * component buffer still holds the full state; only the frame sent to clients
 * carries the appended text:
 *   - `detailDelta`: text appended to the client's current `detail`
 *   - `detailOffset`: length of `detail` this delta extends, so a receiver can
 *     ignore a replayed/duplicated delta or refuse one it has a gap before
 * Anything that is not a pure extension of the previous detail (first update,
 * rewritten snapshot) is sent as a full replacement, which every client handles.
 * A full replacement is also sent each time the detail crosses a
 * RESYNC_INTERVAL_CHARS boundary, so a client that missed a delta (and then
 * refuses every later one as a gap) catches up within that many characters.
 */
export const RESYNC_INTERVAL_CHARS = 4096;

export function compactAgentActivityUpdate(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const previousDetail = previous?.detail;
  const nextDetail = incoming.detail;
  if (
    typeof previousDetail !== 'string'
    || previousDetail.length === 0
    || typeof nextDetail !== 'string'
    || !nextDetail.startsWith(previousDetail)
    || Math.floor(previousDetail.length / RESYNC_INTERVAL_CHARS)
      !== Math.floor(nextDetail.length / RESYNC_INTERVAL_CHARS)
  ) {
    return incoming;
  }

  const { detail: _detail, summary, ...rest } = incoming;
  return {
    ...rest,
    detailDelta: nextDetail.slice(previousDetail.length),
    detailOffset: previousDetail.length,
    // The summary is a bounded prefix of the detail: once capped it stops changing.
    ...(summary !== previous?.summary ? { summary } : {}),
  };
}

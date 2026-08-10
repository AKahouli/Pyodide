import { voiceDispatch, voiceStatus } from '../api';

/**
 * Relays a Gemini tool call to the worky BFF and shapes the tool response.
 * Pure relay — all business logic runs server-side. Errors are returned as an
 * error response so the model can recover conversationally rather than hang.
 */
export async function handleToolCall(
  streamId: string,
  call: { id: string; name: string; args: Record<string, unknown> },
): Promise<{ id: string; name: string; response: Record<string, unknown> }> {
  const wrap = (response: Record<string, unknown>) => ({ id: call.id, name: call.name, response });
  try {
    if (call.name === 'dispatch_task') {
      const r = await voiceDispatch(streamId, String(call.args.message ?? ''));
      return wrap({ runId: r.runId, accepted: r.accepted });
    }
    if (call.name === 'query_status') {
      const s = await voiceStatus(streamId);
      return wrap({ status: s.status, title: s.title });
    }
    return wrap({ error: `unknown tool: ${call.name}` });
  } catch (err) {
    return wrap({ error: err instanceof Error ? err.message : String(err) });
  }
}

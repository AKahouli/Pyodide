import { AUTH_STORAGE_KEYS } from '../../../lib/api/config';

/**
 * Relays a Gemini tool call to the worky-concierge MCP server — and ONLY the
 * MCP, no REST fallback. The MCP forwards to the worky backend, so all business
 * logic still runs server-side; this is a pure relay. Errors are returned as an
 * error response so the model can recover conversationally rather than hang.
 *
 * Gemini Live has no MCP auto-execution, so the browser (WS holder) is the MCP
 * client: it issues a stateless `tools/call` over Streamable HTTP with the
 * user's bearer token, and passes streamId as a tool argument.
 */

/** Fallback MCP endpoint when the session envelope carries no route for a tool. */
const DEFAULT_MCP_URL =
  (import.meta.env.VITE_WORKY_MCP_URL as string | undefined) || 'http://localhost:8080/mcp';

function accessToken(): string | null {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  } catch {
    return null;
  }
}

/** One stateless MCP tools/call against `url`. Returns the tool's result payload, throws on error. */
async function callMcpTool(url: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const token = accessToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Streamable HTTP requires BOTH accept types.
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  // The response is Server-Sent-Events ("event: message\ndata: {json}"); take the last data line.
  const body = await res.text();
  const dataLine = body
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .pop();
  const rpc = JSON.parse(dataLine ? dataLine.slice('data:'.length).trim() : body);

  if (rpc.error) throw new Error(rpc.error.message ?? 'MCP call failed');
  const result = rpc.result;
  const text: string = result?.content?.[0]?.text ?? '';
  if (result?.isError) throw new Error(text || 'tool error');

  // The MCP forwards the backend's ApiResponse envelope: { success, data } / { success:false, error }.
  const parsed = text ? JSON.parse(text) : {};
  if (parsed && parsed.success === false) {
    throw new Error(parsed?.error?.message ?? 'backend error');
  }
  return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
}

export async function handleToolCall(
  streamId: string,
  call: { id: string; name: string; args: Record<string, unknown> },
  toolEndpoints?: Record<string, string>,
  streamIdTools?: string[],
): Promise<{ id: string; name: string; response: Record<string, unknown> }> {
  const wrap = (response: Record<string, unknown>) => ({ id: call.id, name: call.name, response });
  // Route the call to the MCP that owns this tool (from the session envelope),
  // falling back to the default MCP.
  const url = toolEndpoints?.[call.name] ?? DEFAULT_MCP_URL;
  // streamId is injected ONLY for tools that declare it (worky task tools); a
  // tool like search_human_agents doesn't take it and its MCP would reject the
  // unexpected argument. If the backend sent no list, keep the old behavior.
  const needsStreamId = streamIdTools ? streamIdTools.includes(call.name) : true;
  const args = needsStreamId ? { ...call.args, streamId } : { ...call.args };
  try {
    const data = await callMcpTool(url, call.name, args);
    // Gemini's functionResponse.response must be a single JSON object (Struct),
    // never an array/primitive — a tool like search_human_agents returns a bare
    // list, so wrap anything that isn't a plain object.
    const response =
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : { results: data };
    return wrap(response);
  } catch (err) {
    return wrap({ error: err instanceof Error ? err.message : String(err) });
  }
}

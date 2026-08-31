import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall } from './toolCallRelay';

/** The Streamable-HTTP SSE body the MCP returns for a tools/call — the backend's
 *  ApiResponse envelope is wrapped in result.content[0].text. */
function sse(toolText: unknown, isError = false): string {
  const text = typeof toolText === 'string' ? toolText : JSON.stringify(toolText);
  const rpc = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }], isError } };
  return `event: message\ndata: ${JSON.stringify(rpc)}\n\n`;
}

function mockFetch(body: string) {
  const f = vi.fn().mockResolvedValue({ text: () => Promise.resolve(body) } as unknown as Response);
  vi.stubGlobal('fetch', f);
  vi.stubGlobal('localStorage', { getItem: () => 'jwt-abc', setItem: () => {} } as unknown as Storage);
  return f;
}

describe('handleToolCall (MCP relay, no REST fallback)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues a tools/call to the MCP with the tool name, args, streamId and bearer token', async () => {
    const f = mockFetch(sse({ success: true, data: { runId: 'r', sessionId: 's', accepted: true } }));
    const res = await handleToolCall('s1', { id: 'c1', name: 'dispatch_task', args: { message: 'go' } });

    const init = f.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(init.body as string);
    expect(sent.method).toBe('tools/call');
    expect(sent.params).toEqual({ name: 'dispatch_task', arguments: { message: 'go', streamId: 's1' } });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt-abc');
    expect(res).toEqual({
      id: 'c1',
      name: 'dispatch_task',
      response: { runId: 'r', sessionId: 's', accepted: true },
    });
  });

  it('passes taskId + streamId for get_task_details', async () => {
    const f = mockFetch(sse({ success: true, data: { id: 't1', result: 'done' } }));
    const res = await handleToolCall('s1', { id: 'c6', name: 'get_task_details', args: { taskId: 't1' } });
    const sent = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.params.arguments).toEqual({ taskId: 't1', streamId: 's1' });
    expect((res.response as { result: string }).result).toBe('done');
  });

  it('surfaces a backend error (ApiResponse success:false) as an error response', async () => {
    mockFetch(sse({ success: false, error: { message: 'unauthorized' } }));
    const res = await handleToolCall('s1', { id: 'c3', name: 'stop_session', args: {} });
    expect(res.response).toEqual({ error: 'unauthorized' });
  });

  it('surfaces an MCP tool error (isError) as an error response', async () => {
    mockFetch(sse('Error executing tool list_tasks: worky … HTTP 401', true));
    const res = await handleToolCall('s1', { id: 'c5', name: 'list_tasks', args: {} });
    expect((res.response as { error: string }).error).toContain('HTTP 401');
  });

  it('routes each tool to its MCP url and injects streamId only for tools that take it', async () => {
    const endpoints = {
      search_human_agents: 'https://mcp-human-agents.yellowmind.ai/mcp/',
      list_tasks: 'http://localhost:8080/mcp',
    };
    const streamIdTools = ['list_tasks']; // worky tools take streamId; human-agents does NOT

    // human-agents tool -> its MCP, and NO streamId injected
    const f1 = mockFetch(sse([{ id: 'a1', name: 'Firas' }]));
    await handleToolCall(
      's1',
      { id: 'c8', name: 'search_human_agents', args: { role: 'compliance' } },
      endpoints,
      streamIdTools,
    );
    expect(f1.mock.calls[0][0]).toBe('https://mcp-human-agents.yellowmind.ai/mcp/');
    expect(JSON.parse((f1.mock.calls[0][1] as RequestInit).body as string).params.arguments).toEqual({
      role: 'compliance', // no streamId
    });
    // a bare-array tool result must be wrapped in an object (Gemini rejects arrays)
    const r1 = await handleToolCall(
      's1',
      { id: 'c8b', name: 'search_human_agents', args: {} },
      endpoints,
      streamIdTools,
    );
    expect(r1.response).toEqual({ results: [{ id: 'a1', name: 'Firas' }] });

    // worky tool -> default MCP, WITH streamId
    const f2 = mockFetch(sse({ success: true, data: { tasks: [] } }));
    await handleToolCall('s1', { id: 'c9', name: 'list_tasks', args: {} }, endpoints, streamIdTools);
    expect(f2.mock.calls[0][0]).toBe('http://localhost:8080/mcp');
    expect(JSON.parse((f2.mock.calls[0][1] as RequestInit).body as string).params.arguments).toEqual({
      streamId: 's1',
    });
  });
});

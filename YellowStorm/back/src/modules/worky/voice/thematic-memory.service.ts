import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorService } from '../../connector/connector.service';

/**
 * Backend-mediated thematic-memory (smart-memory MCP) access for the voice
 * concierge. The browser cannot call smart-memory directly: it enforces a shared
 * secret key (Authorization: Bearer <key>) and rejects the user JWT the browser
 * relay sends. So the backend holds the key and does the MCP calls here:
 *   - ingestTurn: writes each finished voice turn (mirrors the voice-memory cadence)
 *   - retrieve:   reads a compact context pack for a query (concierge tool)
 *
 * smart-memory's FastMCP transport is STATEFUL, so each call does the initialize
 * handshake to get a session id first. Writes are best-effort (never throw);
 * retrieve returns whatever the MCP gives (or an error string) for the model.
 * On only when both the connector and the key are present.
 */
@Injectable()
export class ThematicMemoryService {
  private readonly logger = new Logger(ThematicMemoryService.name);
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly connectors: ConnectorService,
  ) {
    this.apiKey = this.config.get<string>('worky.thematicMemoryApiKey') ?? '';
  }

  /** Write one finished voice turn to smart-memory (global/user scope). Never throws. */
  async ingestTurn(userId: string, text: string): Promise<{ ok: boolean; skipped?: string }> {
    const said = (text || '').trim();
    if (!said) return { ok: false, skipped: 'empty' };
    const r = await this.callTool(userId, 'memory.write', {
      text: said,
      scope_type: 'global',
      source_type: 'chat',
    });
    if (!r.ok) {
      this.logger.warn(`[thematic-memory] memory.write FAILED via smart-memory user=${userId} err=${r.error}`);
      return { ok: false, skipped: r.skipped ?? 'mcp-error' };
    }
    this.logger.log(
      `[thematic-memory] memory.write OK via SMART-MEMORY user=${userId} chars=${said.length} ` +
        `resp=${r.text.slice(0, 100)}`,
    );
    return { ok: true };
  }

  /** Retrieve a compact context pack for a query (global + agent memory). */
  async retrieve(userId: string, query: string, topK = 8): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const q = (query || '').trim();
    if (!q) return { ok: false, error: 'empty query' };
    const r = await this.callTool(userId, 'memory.retrieve', {
      query: q,
      include_global: true,
      retrieval_policy: 'agent_plus_global',
      top_k: topK,
    });
    if (!r.ok) {
      this.logger.warn(`[thematic-memory] memory.retrieve FAILED via smart-memory user=${userId} err=${r.error}`);
      return { ok: false, error: r.error };
    }
    this.logger.log(`[thematic-memory] memory.retrieve OK via SMART-MEMORY user=${userId} q="${q.slice(0, 60)}"`);
    // The MCP returns a JSON string in content[0].text — hand the parsed object to the model.
    let data: unknown = r.text;
    try {
      data = JSON.parse(r.text);
    } catch {
      /* keep raw text if not JSON */
    }
    return { ok: true, data };
  }

  /**
   * One stateful MCP tool call against smart-memory: initialize → tools/call.
   * Returns the tool's result text (content[0].text) or an error. Never throws.
   */
  private async callTool(
    userId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; text: string; error?: string; skipped?: string }> {
    if (!this.apiKey) return { ok: false, text: '', skipped: 'no-key', error: 'no key configured' };
    const c = await this.connectors.findBySlug('smart-memory');
    if (!c || !c.actions?.some((a) => a.key === name)) {
      return { ok: false, text: '', skipped: 'no-connector', error: 'smart-memory connector unavailable' };
    }

    const url = c.mcpServerUrl;
    const tenant = (c.mcpServerConfig as { headers?: Record<string, string> })?.headers?.['X-Tenant-Id'] ?? '';
    // Identity headers the MCP reads (headers-first, then args): tenant is a static
    // connector header; user is the authenticated caller.
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream', // Streamable HTTP requires BOTH
      authorization: `Bearer ${this.apiKey}`,
      ...(tenant ? { 'X-Tenant-Id': tenant } : {}),
      'X-User-Id': userId,
    };
    try {
      // Handshake: initialize to obtain a session id (notifications/initialized not required).
      const init = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'worky-voice', version: '1' } },
        }),
      });
      const sessionId = init.headers.get('mcp-session-id');
      if (init.status !== 200 || !sessionId) {
        return { ok: false, text: '', skipped: 'init-error', error: `initialize http=${init.status}` };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
      });
      // The MCP replies as SSE ("event: message\ndata: {json}"); take the last data line.
      const body = await res.text();
      const dataLine = body
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .pop();
      const rpc = dataLine ? JSON.parse(dataLine.slice('data:'.length).trim()) : {};
      const text: string = rpc?.result?.content?.[0]?.text ?? '';
      // Business errors ride inside result.content (isError:true or an {"error":...}
      // payload) at HTTP 200 — treat those as failures too.
      const isError = res.status !== 200 || !!rpc.error || rpc?.result?.isError || /"error"\s*:/.test(text);
      if (isError) {
        return { ok: false, text, skipped: 'mcp-error', error: rpc?.error?.message ?? text.slice(0, 200) };
      }
      return { ok: true, text };
    } catch (err) {
      return { ok: false, text: '', skipped: 'exception', error: (err as Error).message };
    }
  }
}

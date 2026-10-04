import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, type FunctionDeclaration } from '@google/genai';
import {
  buildSetupMessage,
  browserReachableMcpUrl,
  connectorActionsToFunctionDeclarations,
  WORKY_CONCIERGE_CONNECTOR_SLUGS,
  THEMATIC_RETRIEVE_TOOL,
} from './voice-concierge.config';
import { ConnectorService } from '../../connector/connector.service';

export interface VoiceSessionEnvelope {
  wsUrl: string;
  setup: Record<string, unknown>;
  /** Map of tool name -> the MCP URL that executes it, so the browser relay can
   *  route each tool call to the right MCP. */
  toolEndpoints: Record<string, string>;
  /** Tools that take the session streamId as an argument (worky task tools).
   *  Tools NOT listed (e.g. human-agents lookup) must not get streamId injected,
   *  or their MCP rejects the unexpected argument. */
  streamIdTools: string[];
  /** voice-memory sidecar WS (mic fork → long-term memory). Empty/absent ⇒ the
   *  browser skips the fork (memory writes off). Runtime-configured server-side. */
  memoryWsUrl: string;
  /** Thematic (smart-memory) ingestion enabled. When true the browser POSTs each
   *  finished turn's transcript to the backend, which writes it to smart-memory
   *  via memory.write (the MCP's shared key can't be exposed to the browser).
   *  False/absent ⇒ off (no active smart-memory connector, or no key configured). */
  thematicMemory?: boolean;
  expiresAt: string;
}

@Injectable()
export class GeminiTokenService implements OnModuleInit {
  private readonly logger = new Logger(GeminiTokenService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly wsBaseUrl: string;
  private readonly tokenTtlSec: number;
  private readonly startTtlSec: number;
  private readonly memoryWsUrl: string;
  private readonly thematicMemoryApiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly connectors: ConnectorService,
  ) {
    this.apiKey = this.config.get<string>('worky.voiceApiKey') ?? '';
    this.model = this.config.get<string>('worky.voiceModel') ?? 'gemini-3.1-flash-live-preview';
    this.voice = this.config.get<string>('worky.voiceName') ?? 'Kore';
    this.wsBaseUrl = this.config.get<string>('worky.voiceWsBaseUrl') ?? '';
    this.tokenTtlSec = this.config.get<number>('worky.voiceTokenTtlSec') ?? 1800;
    this.startTtlSec = this.config.get<number>('worky.voiceSessionStartTtlSec') ?? 60;
    this.memoryWsUrl = this.config.get<string>('worky.voiceMemoryWsUrl') ?? '';
    this.thematicMemoryApiKey = this.config.get<string>('worky.thematicMemoryApiKey') ?? '';
  }

  onModuleInit(): void {
    this.logger.log(
      `Gemini voice token service: model=${this.model} voice=${this.voice} apiKey=${this.apiKey ? 'set' : 'unset'}`,
    );
  }

  async mintSessionToken(
    opts: {
      resumptionHandle?: string;
      prompt?: string;
      requester?: { name?: string; email?: string; role?: string };
    } = {},
  ): Promise<VoiceSessionEnvelope> {
    if (!this.apiKey) throw new Error('Gemini voice is not configured (WORKY_VOICE_API_KEY missing)');

    const now = Date.now();
    const expireMs = now + this.tokenTtlSec * 1000;
    const client = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { apiVersion: 'v1alpha' } });

    let token: { name?: string };
    try {
      token = await client.authTokens.create({
        config: {
          uses: 1,
          expireTime: new Date(expireMs).toISOString(),
          newSessionExpireTime: new Date(now + this.startTtlSec * 1000).toISOString(),
          httpOptions: { apiVersion: 'v1alpha' },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini token mint failed: ${message}`);
    }

    if (!token?.name) throw new Error('Gemini token mint returned no token name');

    // The concierge's tools are the MCP connectors' actions — the connectors are
    // the source of truth, no hardcoded tool list. Each connector's tools route
    // to that connector's MCP (toolEndpoints), which the browser relay honors.
    const connectors = (
      await Promise.all(WORKY_CONCIERGE_CONNECTOR_SLUGS.map((s) => this.connectors.findBySlug(s)))
    ).filter((c): c is NonNullable<typeof c> => !!c && !!c.actions?.length);

    if (!connectors.length) {
      throw new Error(
        `voice concierge tools unavailable: none of [${WORKY_CONCIERGE_CONNECTOR_SLUGS.join(', ')}] ` +
          'is an active connector with actions',
      );
    }

    const functionDeclarations: FunctionDeclaration[] = [];
    const toolEndpoints: Record<string, string> = {};
    const streamIdTools: string[] = [];
    for (const c of connectors) {
      const url = browserReachableMcpUrl(c.mcpServerUrl);
      for (const action of c.actions) {
        const props = (action.parameterSchema)?.properties as
          | Record<string, unknown>
          | undefined;
        if (props && 'streamId' in props) streamIdTools.push(action.key);
      }
      for (const decl of connectorActionsToFunctionDeclarations(c.actions)) {
        functionDeclarations.push(decl);
        if (decl.name) toolEndpoints[decl.name] = url;
      }
    }

    // Thematic memory (smart-memory) ingestion — backend-mediated, NOT a browser
    // tool: the smart-memory MCP needs a shared secret key the browser can't hold,
    // so the browser only signals per-turn transcripts to our backend endpoint,
    // which does the memory.write. On only when both the connector and key exist.
    const smart = await this.connectors.findBySlug('smart-memory');
    const thematicMemory = !!(smart?.actions?.some((a) => a.key === 'memory.write') && this.thematicMemoryApiKey);
    // Give the model a retrieval tool too (backend-proxied — see THEMATIC_RETRIEVE_TOOL).
    if (thematicMemory && smart?.actions?.some((a) => a.key === 'memory.retrieve')) {
      functionDeclarations.push(THEMATIC_RETRIEVE_TOOL);
    }

    this.logger.log(
      `[voice] concierge session created — tools from [${connectors.map((c) => c.slug).join(', ')}]: ` +
        Object.entries(toolEndpoints)
          .map(([t, u]) => `${t}→${u}`)
          .join(', '),
    );

    return {
      wsUrl: `${this.wsBaseUrl}?access_token=${token.name}`,
      // The backend authors the full session setup (model + modalities + voice +
      // concierge system prompt + tools) in raw-proto shape so the concierge
      // reliably has its tools and persona. Tools come from the connectors above.
      // The client relays this opaque blob verbatim; the API key never leaves
      // the server.
      setup: buildSetupMessage(this.model, this.voice, functionDeclarations, opts),
      toolEndpoints,
      streamIdTools,
      memoryWsUrl: this.memoryWsUrl,
      thematicMemory,
      expiresAt: new Date(expireMs).toISOString(),
    };
  }
}

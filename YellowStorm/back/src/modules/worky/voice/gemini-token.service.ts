import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { buildSetupMessage } from './voice-concierge.config';

export interface VoiceSessionEnvelope {
  wsUrl: string;
  setup: Record<string, unknown>;
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

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('worky.voiceApiKey') ?? '';
    this.model = this.config.get<string>('worky.voiceModel') ?? 'gemini-3.1-flash-live-preview';
    this.voice = this.config.get<string>('worky.voiceName') ?? 'Kore';
    this.wsBaseUrl = this.config.get<string>('worky.voiceWsBaseUrl') ?? '';
    this.tokenTtlSec = this.config.get<number>('worky.voiceTokenTtlSec') ?? 1800;
    this.startTtlSec = this.config.get<number>('worky.voiceSessionStartTtlSec') ?? 60;
  }

  onModuleInit(): void {
    this.logger.log(
      `Gemini voice token service: model=${this.model} voice=${this.voice} apiKey=${this.apiKey ? 'set' : 'unset'}`,
    );
  }

  async mintSessionToken(
    opts: { resumptionHandle?: string; prompt?: string } = {},
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

    return {
      wsUrl: `${this.wsBaseUrl}?access_token=${token.name}`,
      // The backend authors the full session setup (model + modalities + voice +
      // concierge system prompt + tools) in raw-proto shape so the concierge
      // reliably has its tools and persona. The client relays this opaque blob
      // verbatim and authors nothing; the API key never leaves the server.
      setup: buildSetupMessage(this.model, this.voice, opts),
      expiresAt: new Date(expireMs).toISOString(),
    };
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Speech-to-text proxy for Worky's voice composer.
 *
 * The browser records a short clip and uploads it; this service forwards the
 * audio to OpenRouter's `POST /api/v1/audio/transcriptions` (a JSON body with
 * base64 audio under `input_audio`) and returns the transcript.
 *
 * Proxying through NestJS (rather than browser → OpenRouter directly) hides the
 * API key, lets the existing auth guard + `WORKY_STREAM_WRITE` permission gate
 * it, and mirrors `WorkyRuntimeClient`'s native-`fetch` approach (no
 * `@nestjs/axios` dependency).
 */
export interface WorkyTranscriptionResult {
  text: string;
  language?: string;
}

@Injectable()
export class WorkySttService implements OnModuleInit {
  private readonly logger = new Logger(WorkySttService.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly language: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly providerOrder: string[];

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('worky.sttBaseUrl') ?? 'https://openrouter.ai/api';
    this.model = this.config.get<string>('worky.sttModel') ?? 'openai/whisper-large-v3-turbo';
    this.language = this.config.get<string>('worky.sttLanguage') ?? '';
    this.timeoutMs = this.config.get<number>('worky.sttTimeoutMs') ?? 30000;
    this.apiKey = this.config.get<string>('worky.sttApiKey') ?? '';
    // Provider routing, e.g. 'groq' to pin Whisper to Groq (the only provider
    // that serves it). Comma-separated for an ordered fallback list.
    this.providerOrder = (this.config.get<string>('worky.sttProvider') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }

  /**
   * Log the resolved STT config at boot (no secrets) so a stale-process /
   * unloaded-env mismatch is obvious — e.g. an empty `providerOrder` here while
   * OpenRouter routes to its default provider.
   */
  onModuleInit(): void {
    this.logger.log('Worky STT config resolved', {
      baseUrl: this.baseUrl,
      model: this.model,
      providerOrder: this.providerOrder,
      apiKey: this.apiKey ? 'set' : 'unset',
    });
  }

  /**
   * Transcribe a recorded audio clip to text. Throws on transport/HTTP errors
   * so the controller maps them to a 4xx/5xx the UI surfaces as a failed
   * transcription (the mic button re-enables and the user can retry or type).
   */
  async transcribe(audio: Buffer, mimetype: string): Promise<WorkyTranscriptionResult> {
    const payload: Record<string, unknown> = {
      model: this.model,
      input_audio: { data: audio.toString('base64'), format: this.audioFormat(mimetype) },
    };
    if (this.language) payload.language = this.language;
    // Pin to a specific upstream provider (e.g. Groq). `only` is an exclusive
    // allow-list, so OpenRouter won't fall back to a provider that can't serve
    // the model.
    if (this.providerOrder.length) {
      payload.provider = { only: this.providerOrder, allow_fallbacks: false };
    }

    const url = `${this.baseUrl}/v1/audio/transcriptions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
      headers['X-Title'] = 'YellowStorm Worky'; // OpenRouter attribution (optional).
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn('Worky STT request failed', { url, message });
      throw new Error(`Speech-to-text service unreachable: ${message}`);
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      this.logger.warn('Worky STT non-ok response', {
        url,
        status: response.status,
        body: errBody.slice(0, 500),
      });
      throw new Error(`Speech-to-text service returned ${response.status}`);
    }

    const data = (await response.json().catch(() => null)) as
      | { text?: string; language?: string }
      | null;
    return { text: (data?.text ?? '').trim(), language: data?.language };
  }

  /** Map a recorder MIME type to OpenRouter's `format` token (webm/mp3/m4a/…). */
  private audioFormat(mimetype: string): string {
    const subtype = (mimetype || '').split(';')[0].split('/')[1]?.toLowerCase();
    if (!subtype) return 'webm';
    if (subtype === 'mpeg') return 'mp3';
    if (subtype === 'x-m4a' || subtype === 'mp4') return 'm4a';
    return subtype; // webm, ogg, wav, flac, aac, …
  }
}

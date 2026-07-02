import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Text-to-speech proxy for Worky's voice replies. Forwards agent answer text to
 * OpenRouter's `POST /api/v1/audio/speech` and returns the audio bytes for the
 * browser to play. Reuses the STT OpenRouter base URL + API key (same account).
 */
export interface WorkySpeechResult {
  audio: Buffer;
  contentType: string;
}

const FORMAT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

@Injectable()
export class WorkyTtsService implements OnModuleInit {
  private readonly logger = new Logger(WorkyTtsService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly format: string;
  private readonly timeoutMs: number;
  private readonly maxChars: number;
  private readonly providerOrder: string[];

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('worky.sttBaseUrl') ?? 'https://openrouter.ai/api';
    this.apiKey = this.config.get<string>('worky.sttApiKey') ?? '';
    this.model = this.config.get<string>('worky.ttsModel') ?? 'google/gemini-3.1-flash-tts-preview';
    this.voice = this.config.get<string>('worky.ttsVoice') ?? 'Kore';
    this.format = this.config.get<string>('worky.ttsFormat') ?? 'pcm';
    this.timeoutMs = this.config.get<number>('worky.ttsTimeoutMs') ?? 30000;
    this.maxChars = this.config.get<number>('worky.ttsMaxChars') ?? 2000;
    // OpenRouter provider routing, e.g. 'elevenlabs'. Comma-separated for an
    // ordered fallback list. Empty = let OpenRouter choose.
    this.providerOrder = (this.config.get<string>('worky.ttsProvider') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }

  onModuleInit(): void {
    this.logger.log('Worky TTS config resolved', {
      baseUrl: this.baseUrl,
      model: this.model,
      voice: this.voice,
      format: this.format,
      providerOrder: this.providerOrder,
      apiKey: this.apiKey ? 'set' : 'unset',
    });
  }

  /** Synthesize speech for `text`. Throws on transport/HTTP errors. */
  async speak(text: string, voiceOverride?: string): Promise<WorkySpeechResult> {
    const input = text.trim().slice(0, this.maxChars);
    if (!input) throw new Error('Empty text');

    const payload: Record<string, unknown> = {
      input,
      model: this.model,
      voice: voiceOverride || this.voice,
      response_format: this.format,
    };
    if (this.providerOrder.length) {
      payload.provider = { only: this.providerOrder, allow_fallbacks: false };
    }

    const url = `${this.baseUrl}/v1/audio/speech`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
      headers['X-Title'] = 'YellowStorm Worky';
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
      this.logger.warn('Worky TTS request failed', { url, message });
      throw new Error(`Text-to-speech service unreachable: ${message}`);
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      this.logger.warn('Worky TTS non-ok response', {
        url,
        status: response.status,
        body: errBody.slice(0, 500),
      });
      throw new Error(`Text-to-speech service returned ${response.status}`);
    }

    const raw = Buffer.from(await response.arrayBuffer());
    const upstreamType =
      response.headers.get('content-type') || FORMAT_MIME[this.format] || 'application/octet-stream';
    // Some models (e.g. Gemini TTS) only emit raw PCM, which browsers can't
    // play. Wrap it in a WAV container so the front-end <audio> handles it.
    if (/audio\/(pcm|l16)/i.test(upstreamType)) {
      const { rate, channels } = parsePcmParams(upstreamType);
      return { audio: pcmToWav(raw, rate, channels), contentType: 'audio/wav' };
    }
    return { audio: raw, contentType: upstreamType };
  }
}

/** Parse `audio/pcm;rate=24000;channels=1` → { rate, channels } (Gemini defaults). */
function parsePcmParams(contentType: string): { rate: number; channels: number } {
  return {
    rate: Number(/rate=(\d+)/i.exec(contentType)?.[1]) || 24000,
    channels: Number(/channels=(\d+)/i.exec(contentType)?.[1]) || 1,
  };
}

/** Wrap raw little-endian 16-bit PCM in a 44-byte WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bits = 16): Buffer {
  const blockAlign = (channels * bits) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

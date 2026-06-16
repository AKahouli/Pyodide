import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WhatsAppPairingSnapshot {
  qrCode?: string;
  pairingCode?: string;
}

interface CacheEntry {
  snapshot: WhatsAppPairingSnapshot;
  expiresAtMs: number;
}

@Injectable()
export class WhatsAppPairingCacheService implements OnModuleDestroy {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    const intervalMs = 60_000;
    this.cleanupTimer = setInterval(() => this.evictExpired(), intervalMs);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private pairingTimeoutMs(): number {
    return this.configService.get<number>('whatsapp.pairingTimeoutMs', 300_000);
  }

  set(sessionId: string, snapshot: WhatsAppPairingSnapshot): void {
    const current = this.cache.get(sessionId)?.snapshot ?? {};
    this.cache.set(sessionId, {
      snapshot: { ...current, ...snapshot },
      expiresAtMs: Date.now() + this.pairingTimeoutMs(),
    });
  }

  get(sessionId: string): WhatsAppPairingSnapshot | undefined {
    const entry = this.cache.get(sessionId);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAtMs) {
      this.cache.delete(sessionId);
      return undefined;
    }
    return entry.snapshot;
  }

  clear(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.cache) {
      if (now > entry.expiresAtMs) {
        this.cache.delete(sessionId);
      }
    }
  }
}

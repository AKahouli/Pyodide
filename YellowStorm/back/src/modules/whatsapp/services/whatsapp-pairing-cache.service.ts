import { Injectable } from '@nestjs/common';

export interface WhatsAppPairingSnapshot {
  qrCode?: string;
  pairingCode?: string;
}

@Injectable()
export class WhatsAppPairingCacheService {
  private readonly cache = new Map<string, WhatsAppPairingSnapshot>();

  set(sessionId: string, snapshot: WhatsAppPairingSnapshot): void {
    const current = this.cache.get(sessionId) ?? {};
    this.cache.set(sessionId, { ...current, ...snapshot });
  }

  get(sessionId: string): WhatsAppPairingSnapshot | undefined {
    return this.cache.get(sessionId);
  }

  clear(sessionId: string): void {
    this.cache.delete(sessionId);
  }
}

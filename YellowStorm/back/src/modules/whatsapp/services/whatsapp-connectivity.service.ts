import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import {
  WHATSAPP_NETWORK_UNREACHABLE_MESSAGE,
  WHATSAPP_SW_JS_URL,
} from '../baileys/whatsapp-network.util';

const PROBE_CACHE_MS = 60_000;

@Injectable()
export class WhatsAppConnectivityService implements OnModuleInit {
  private lastProbeAt = 0;
  private lastReachable = true;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WhatsAppConnectivityService.name);
  }

  async onModuleInit(): Promise<void> {
    if (!this.configService.get<boolean>('whatsapp.enabled', true)) {
      return;
    }
    void this.probeWhatsAppServers(true).catch((error) => {
      this.logger.warn('WhatsApp connectivity probe failed on startup', {
        error: (error as Error).message,
      });
    });
  }

  async assertReachable(force = false): Promise<void> {
    const result = await this.probeWhatsAppServers(force);
    if (!result.reachable) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_NETWORK_UNREACHABLE,
        WHATSAPP_NETWORK_UNREACHABLE_MESSAGE,
      );
    }
  }

  async probeWhatsAppServers(
    force = false,
  ): Promise<{ reachable: boolean; error?: string }> {
    if (!force && Date.now() - this.lastProbeAt < PROBE_CACHE_MS) {
      return { reachable: this.lastReachable };
    }

    const timeoutMs = this.configService.get<number>(
      'whatsapp.connectivityProbeTimeoutMs',
      10000,
    );

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(WHATSAPP_SW_JS_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YellowStorm/1.0)' },
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.lastProbeAt = Date.now();
      this.lastReachable = true;
      return { reachable: true };
    } catch (error) {
      const message = (error as Error).message;
      this.lastProbeAt = Date.now();
      this.lastReachable = false;
      this.logger.warn('WhatsApp connectivity probe failed', { error: message });
      return { reachable: false, error: message };
    }
  }
}

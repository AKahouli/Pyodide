import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@modules/logger';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppSessionManager } from './whatsapp-session.manager';
import { WhatsAppCircuitBreakerService } from './whatsapp-circuit-breaker.service';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';

export interface WhatsAppHealthDetail {
  whatsappReachable: boolean;
  adkConfigured: boolean;
  sessionCount: number;
  circuitBreakerState: Record<string, string>;
  metrics: Record<string, unknown>;
}

@Injectable()
export class WhatsAppHealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly connectivity: WhatsAppConnectivityService,
    private readonly sessionManager: WhatsAppSessionManager,
    private readonly circuitBreaker: WhatsAppCircuitBreakerService,
    private readonly metrics: WhatsAppMetricsService,
  ) {
    this.logger.setContext(WhatsAppHealthService.name);
  }

  async check(): Promise<WhatsAppHealthDetail> {
    const adkUrl = this.configService.get<string>('whatsapp.adkUrl', '').trim();
    const [probeResult, sessionCount] = await Promise.all([
      this.connectivity.probeWhatsAppServers(false),
      this.sessionManager.getActiveSessionCount(),
    ]);

    const circuitBreakerState: Record<string, string> = {};
    const adkKey = `adk:${adkUrl || 'unknown'}`;
    circuitBreakerState[adkKey] = this.circuitBreaker.getState(adkKey);

    return {
      whatsappReachable: probeResult.reachable,
      adkConfigured: adkUrl.length > 0,
      sessionCount,
      circuitBreakerState,
      metrics: this.metrics.getSnapshot(),
    };
  }
}

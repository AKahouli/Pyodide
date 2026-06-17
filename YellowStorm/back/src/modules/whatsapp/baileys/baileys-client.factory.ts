import { Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { LoggerService } from '@modules/logger';
import { loadBaileys } from './baileys-loader';
import { resolveWhatsAppWebVersion } from './baileys-version.resolver';

@Injectable()
export class BaileysClientFactory {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(BaileysClientFactory.name);
  }

  async createSocket(params: {
    auth: import('@whiskeysockets/baileys').AuthenticationState;
    baileysLogger: Logger;
    probeTimeoutMs?: number;
  }): Promise<import('@whiskeysockets/baileys').WASocket> {
    const baileys = await loadBaileys();
    const version = await resolveWhatsAppWebVersion(
      this.logger,
      params.probeTimeoutMs,
    );

    return baileys.default({
      version,
      auth: {
        creds: params.auth.creds,
        keys: baileys.makeCacheableSignalKeyStore(params.auth.keys, params.baileysLogger),
      },
      logger: params.baileysLogger,
      printQRInTerminal: false,
      browser: baileys.Browsers.appropriate('YellowStorm'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      shouldIgnoreJid: (jid) => typeof jid === 'string' && jid.endsWith('@broadcast'),
      getMessage: async () => undefined,
    });
  }
}

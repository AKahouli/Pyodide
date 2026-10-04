import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { LoggerService } from '../logger';
import { ReconnectBackoff } from '@common/utils';

interface ReconnectConfig {
  enabled: boolean;
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  multiplier: number;
}

interface HealthCheckConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface EmailConnectionStatus {
  available: boolean;
  connected: boolean;
  error: string | null;
  lastCheckedAt?: Date;
  lastConnectedAt?: Date;
  reconnectAttempts: number;
  isReconnecting: boolean;
}

@Injectable()
export class EmailConnectionService implements OnModuleInit, OnModuleDestroy {
  private transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;
  private msalClient: ConfidentialClientApplication | null = null;

  private isConnected = false;
  private isConnecting = false;
  private lastError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private lastConnectedAt: Date | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private readonly provider: 'smtp' | 'outlook';
  private readonly smtpHost: string;
  private readonly smtpPort: number;
  private readonly smtpSecure: boolean;
  private readonly smtpUser: string;
  private readonly smtpPassword: string;
  private readonly poolEnabled: boolean;
  private readonly poolMaxConnections: number;
  private readonly poolMaxMessages: number;
  private readonly connectionTimeoutMs: number;
  private readonly socketTimeoutMs: number;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly reconnect: ReconnectBackoff;
  private readonly healthCheckConfig: HealthCheckConfig;

  private readonly outlookClientId: string;
  private readonly outlookClientSecret: string;
  private readonly outlookTenantId: string;
  private readonly outlookAuthority: string;
  private readonly outlookSenderEmail: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EmailConnectionService.name);

    this.provider = this.configService.get<'smtp' | 'outlook'>('email.provider', 'smtp');

    this.smtpHost = this.configService.get<string>('email.smtp.host', '');
    this.smtpPort = this.configService.get<number>('email.smtp.port', 587);
    this.smtpSecure = this.configService.get<boolean>('email.smtp.secure', false);
    this.smtpUser = this.configService.get<string>('email.smtp.user', '');
    this.smtpPassword = this.configService.get<string>('email.smtp.password', '');

    this.poolEnabled = this.configService.get<boolean>('email.pool.enabled', true);
    this.poolMaxConnections = this.configService.get<number>('email.pool.maxConnections', 5);
    this.poolMaxMessages = this.configService.get<number>('email.pool.maxMessages', 100);
    this.connectionTimeoutMs = this.configService.get<number>('email.connectionTimeoutMs', 10000);
    this.socketTimeoutMs = this.configService.get<number>('email.socketTimeoutMs', 30000);

    this.outlookClientId = this.configService.get<string>('email.outlook.clientId', '');
    this.outlookClientSecret = this.configService.get<string>('email.outlook.clientSecret', '');
    this.outlookTenantId = this.configService.get<string>('email.outlook.tenantId', '');
    this.outlookAuthority = this.configService.get<string>('email.outlook.authority', 'https://login.microsoftonline.com');
    this.outlookSenderEmail = this.configService.get<string>('email.outlook.senderEmail', '');

    this.reconnectConfig = {
      enabled: this.configService.get<boolean>('email.reconnect.enabled', true),
      initialDelayMs: this.configService.get<number>('email.reconnect.initialDelayMs', 1000),
      maxDelayMs: this.configService.get<number>('email.reconnect.maxDelayMs', 120000),
      maxAttempts: this.configService.get<number>('email.reconnect.maxAttempts', 0),
      multiplier: this.configService.get<number>('email.reconnect.multiplier', 2),
    };

    this.reconnect = new ReconnectBackoff(this.reconnectConfig, {
      connect: () => this.connect(),
      label: () => this.provider === 'outlook' ? 'Outlook' : 'SMTP',
      log: (message) => { this.logger.log(message, { display: true, save: false }); },
      warn: (message) => { this.logger.warn(message); },
      error: (message) => { this.logger.error(message); },
    });

    this.healthCheckConfig = {
      enabled: this.configService.get<boolean>('email.healthCheck.enabled', true),
      intervalMs: this.configService.get<number>('email.healthCheck.intervalMs', 60000),
    };
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
    this.startHealthCheck();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopHealthCheck();
    this.reconnect.clear();
    await this.closeTransporter();
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      this.logger.debug('Connection attempt already in progress');
      return;
    }

    if (this.provider === 'outlook') {
      return this.connectOutlook();
    }

    if (!this.smtpHost) {
      this.logger.warn('SMTP host not configured. Email service disabled.');
      this.lastError = 'SMTP host not configured';
      return;
    }

    this.isConnecting = true;

    try {
      this.logger.log('Attempting to connect to SMTP server...', {
        attempt: this.reconnect.attempts + 1,
        host: this.smtpHost,
        port: this.smtpPort,
      },{display:true,save:false});

      // Close existing transporter if any
      await this.closeTransporter();

      this.transporter = nodemailer.createTransport(this.buildSmtpTransportOptions());

      // Verify connection
      await this.transporter.verify();

      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.lastConnectedAt = new Date();
      this.reconnect.reset();

      this.logger.log('SMTP connection established', {
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpSecure,
        pool: this.poolEnabled,
      });
    } catch (error) {
      const err = error as Error;
      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      this.logger.error('SMTP connection failed', {
        message: err.message,
        attempt: this.reconnect.attempts + 1,

      },{display:true,save:false});

      this.reconnect.schedule();
    } finally {
      this.isConnecting = false;
    }
  }

  private async connectOutlook(): Promise<void> {
    if (!this.outlookClientId || !this.outlookClientSecret || !this.outlookTenantId) {
      this.logger.warn('Outlook credentials not configured. Email service disabled.');
      this.lastError = 'Outlook credentials not configured';
      return;
    }

    this.isConnecting = true;

    try {
      this.logger.log('Attempting to connect to Outlook (Microsoft Graph)...', {
        attempt: this.reconnect.attempts + 1,
        tenantId: this.outlookTenantId,
        senderEmail: this.outlookSenderEmail,
      },{display:true,save:false});

      this.msalClient = new ConfidentialClientApplication({
        auth: {
          clientId: this.outlookClientId,
          clientSecret: this.outlookClientSecret,
          authority: `${this.resolveHttpsAuthority(this.outlookAuthority)}/${this.outlookTenantId}`,
        },
      });

      // Verify credentials by acquiring a token
      const tokenResponse = await this.msalClient.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
      });

      if (!tokenResponse?.accessToken) {
        throw new Error('Failed to acquire access token from Azure AD');
      }

      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.lastConnectedAt = new Date();
      this.reconnect.reset();

      this.logger.log('Outlook connection established', {
        tenantId: this.outlookTenantId,
        senderEmail: this.outlookSenderEmail,
      });
    } catch (error) {
      const err = error as Error;
      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      this.logger.error('Outlook connection failed', {
        message: err.message,
        attempt: this.reconnect.attempts + 1,
      },{display:true,save:false});

      this.reconnect.schedule();
    } finally {
      this.isConnecting = false;
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (this.provider === 'outlook') {
      return this.verifyOutlookConnection();
    }

    if (!this.transporter) {
      this.isConnected = false;
      this.lastError = 'Transporter not initialized';
      this.lastCheckedAt = new Date();
      return false;
    }

    try {
      await this.transporter.verify();

      const wasDisconnected = !this.isConnected;
      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.lastConnectedAt = new Date();
      this.reconnect.reset();

      if (wasDisconnected) {
        this.logger.log('SMTP connection restored');
      }

      return true;
    } catch (error) {
      const err = error as Error;
      const wasConnected = this.isConnected;

      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      if (wasConnected) {
        this.logger.warn('SMTP connection lost', {
          error: err.message,
        });
        this.reconnect.schedule();
      }

      return false;
    }
  }

  private async verifyOutlookConnection(): Promise<boolean> {
    if (!this.msalClient) {
      this.isConnected = false;
      this.lastError = 'MSAL client not initialized';
      this.lastCheckedAt = new Date();
      return false;
    }

    try {
      const tokenResponse = await this.msalClient.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
      });

      if (!tokenResponse?.accessToken) {
        throw new Error('Failed to acquire access token');
      }

      const wasDisconnected = !this.isConnected;
      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.lastConnectedAt = new Date();
      this.reconnect.reset();

      if (wasDisconnected) {
        this.logger.log('Outlook connection restored');
      }

      return true;
    } catch (error) {
      const err = error as Error;
      const wasConnected = this.isConnected;

      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      if (wasConnected) {
        this.logger.warn('Outlook connection lost', {
          error: err.message,
        });
        this.reconnect.schedule();
      }

      return false;
    }
  }

  private async closeTransporter(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
  }

  private buildSmtpTransportOptions(): SMTPTransport.Options {
    const options: SMTPTransport.Options = {
      host: this.resolveSmtpHost(this.smtpHost),
      port: this.smtpPort,
      secure: this.smtpSecure,
      connectionTimeout: this.connectionTimeoutMs,
      socketTimeout: this.socketTimeoutMs,
      tls: {
        minVersion: 'TLSv1.2',
      },
    };

    // Port 587 uses STARTTLS; require upgrade instead of plaintext SMTP.
    if (!this.smtpSecure && this.smtpPort === 587) {
      options.requireTLS = true;
    }

    if (this.smtpUser && this.smtpPassword) {
      options.auth = {
        user: this.smtpUser,
        pass: this.smtpPassword,
      };
    }

    if (!this.poolEnabled) {
      return options;
    }

    return {
      ...options,
      pool: true,
      maxConnections: this.poolMaxConnections,
      maxMessages: this.poolMaxMessages,
    } as SMTPTransport.Options;
  }

  private resolveSmtpHost(host: string): string {
    const trimmed = host.trim();
    const lower = trimmed.toLowerCase();

    if (lower.startsWith('http://')) {
      throw new Error('SMTP host must not use the http:// protocol');
    }

    if (lower.startsWith('https://')) {
      return trimmed.slice('https://'.length);
    }

    return trimmed;
  }

  private resolveHttpsAuthority(authority: string): string {
    const trimmed = authority.trim().replace(/\/+$/, '');
    const lower = trimmed.toLowerCase();

    if (lower.startsWith('http://')) {
      throw new Error('Azure AD authority must use https://');
    }

    if (lower.startsWith('https://')) {
      return trimmed;
    }

    return `https://${trimmed}`;
  }

  private startHealthCheck(): void {
    if (!this.healthCheckConfig.enabled || !this.isAvailable()) {
      return;
    }

    const label = this.provider === 'outlook' ? 'Outlook' : 'SMTP';
    this.logger.log(`Starting ${label} health check`, {
      intervalMs: this.healthCheckConfig.intervalMs,
    });

    this.healthCheckInterval = setInterval(async () => {
      await this.verifyConnection();
    }, this.healthCheckConfig.intervalMs);

    this.healthCheckInterval.unref();
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }


  // Public accessors

  getProvider(): 'smtp' | 'outlook' {
    return this.provider;
  }

  getSenderEmail(): string {
    return this.outlookSenderEmail;
  }

  async getAccessToken(): Promise<string> {
    if (!this.msalClient) {
      throw new Error('MSAL client not initialized');
    }

    const tokenResponse = await this.msalClient.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });

    if (!tokenResponse?.accessToken) {
      throw new Error('Failed to acquire access token');
    }

    return tokenResponse.accessToken;
  }

  isAvailable(): boolean {
    if (this.provider === 'outlook') {
      return !!(this.outlookClientId && this.outlookClientSecret && this.outlookTenantId);
    }
    return !!this.smtpHost;
  }

  isConnectedNow(): boolean {
    return this.isConnected;
  }

  getTransporter(): Transporter<SMTPTransport.SentMessageInfo> | null {
    return this.transporter;
  }

  getHealthStatus(): EmailConnectionStatus {
    return {
      available: this.isAvailable(),
      connected: this.isConnected,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt || undefined,
      lastConnectedAt: this.lastConnectedAt || undefined,
      reconnectAttempts: this.reconnect.attempts,
      isReconnecting: this.reconnect.isWaiting,
    };
  }
}

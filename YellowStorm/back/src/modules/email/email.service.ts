import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { LoggerService } from '../logger';
import {
  SendEmailOptions,
  SendEmailResult,
  BulkEmailOptions,
  BulkEmailResult,
  EmailAddress,
  EmailAttachment,
} from './interfaces/email.interface';
import { EmailConnectionService, EmailConnectionStatus } from './email-connection.service';
import { randomBackoffJitter } from '@common/utils';

interface RetryConfig {
  enabled: boolean;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

interface GraphRecipient {
  emailAddress: { address: string; name?: string };
}

interface GraphAttachment {
  '@odata.type': string;
  name: string;
  contentType: string;
  contentBytes: string;
  contentId?: string;
  isInline?: boolean;
}

interface GraphPayload {
  message: {
    subject: string;
    body: { contentType: string; content: string };
    toRecipients: GraphRecipient[];
    ccRecipients?: GraphRecipient[];
    bccRecipients?: GraphRecipient[];
    replyTo?: GraphRecipient[];
    importance?: string;
    internetMessageHeaders?: { name: string; value: string }[];
    attachments?: GraphAttachment[];
  };
  saveToSentItems: boolean;
}

@Injectable()
export class EmailService {
  private readonly defaultFrom: EmailAddress;
  private readonly retryConfig: RetryConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly connectionService: EmailConnectionService,
  ) {
    this.logger.setContext(EmailService.name);

    this.defaultFrom = {
      name: this.configService.get<string>('email.from.name', 'YelloStorm'),
      address: this.configService.get<string>('email.from.address', 'noreply@yellostorm.com'),
    };

    this.retryConfig = {
      enabled: this.configService.get<boolean>('email.retry.enabled', true),
      maxAttempts: this.configService.get<number>('email.retry.maxAttempts', 3),
      initialDelayMs: this.configService.get<number>('email.retry.initialDelayMs', 1000),
      maxDelayMs: this.configService.get<number>('email.retry.maxDelayMs', 10000),
      multiplier: this.configService.get<number>('email.retry.multiplier', 2),
    };
  }

  /**
   * Check if the email service is available
   */
  isAvailable(): boolean {
    return this.connectionService.isAvailable();
  }

  /**
   * Get email service health status (live status from connection service)
   */
  getHealthStatus(): EmailConnectionStatus {
    return this.connectionService.getHealthStatus();
  }

  /**
   * Get the transporter from connection service
   */
  private getTransporter(): Transporter<SMTPTransport.SentMessageInfo> {
    const transporter = this.connectionService.getTransporter();
    if (!transporter) {
      throw new Error('Email service is not available');
    }
    return transporter;
  }

  /**
   * Send a single email
   */
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const provider = this.connectionService.getProvider();

    if (provider === 'outlook') {
      return this.sendViaOutlook(options);
    }

    return this.sendViaSmtp(options);
  }

  /**
   * Send multiple emails in bulk
   */
  async sendBulk(options: BulkEmailOptions): Promise<BulkEmailResult> {
    const results: SendEmailResult[] = [];
    let successful = 0;
    let failed = 0;

    for (const email of options.emails) {
      const result = await this.send(email);
      results.push(result);

      if (result.success) {
        successful++;
      } else {
        failed++;

        if (options.stopOnError) {
          break;
        }
      }

      // Rate limiting delay between emails
      if (options.delayBetweenMs && options.delayBetweenMs > 0) {
        await this.sleep(options.delayBetweenMs);
      }
    }

    this.logger.log('Bulk email completed', {
      total: options.emails.length,
      successful,
      failed,
    });

    return {
      total: options.emails.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Send a simple text email (convenience method)
   */
  async sendText(to: string, subject: string, text: string): Promise<SendEmailResult> {
    return this.send({ to, subject, text });
  }

  /**
   * Send a simple HTML email (convenience method)
   */
  async sendHtml(to: string, subject: string, html: string): Promise<SendEmailResult> {
    return this.send({ to, subject, html });
  }

  // ============ SMTP Methods ============

  private async sendViaSmtp(options: SendEmailOptions): Promise<SendEmailResult> {
    const transporter = this.connectionService.getTransporter();
    if (!transporter) {
      return {
        success: false,
        error: 'Email service is not available',
        attempts: 0,
      };
    }

    const from = options.from || this.defaultFrom;
    let lastError: Error | null = null;
    let attempts = 0;

    const maxAttempts = this.retryConfig.enabled ? this.retryConfig.maxAttempts : 1;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const result = await transporter.sendMail({
          from: this.formatAddress(from),
          to: this.formatAddresses(options.to),
          cc: options.cc ? this.formatAddresses(options.cc) : undefined,
          bcc: options.bcc ? this.formatAddresses(options.bcc) : undefined,
          replyTo: options.replyTo ? this.formatAddress(options.replyTo) : undefined,
          subject: options.subject,
          text: options.text,
          html: options.html,
          attachments: options.attachments?.map((att) => ({
            filename: att.filename,
            content: att.content,
            path: att.path,
            contentType: att.contentType,
            cid: att.cid,
          })),
          headers: options.headers,
          priority: options.priority,
        });

        this.logger.log('Email sent successfully via SMTP', {
          messageId: result.messageId,
          to: this.maskEmail(this.formatAddresses(options.to)),
          subject: options.subject.substring(0, 50),
          attempts,
        });

        return {
          success: true,
          messageId: result.messageId,
          accepted: result.accepted as string[],
          rejected: result.rejected as string[],
          attempts,
          sentAt: new Date(),
        };
      } catch (error) {
        lastError = error as Error;

        this.logger.warn('Email send attempt failed (SMTP)', {
          attempt: attempts,
          maxAttempts,
          error: lastError.message,
        });

        // Don't retry on certain errors
        if (this.isNonRetryableError(lastError)) {
          break;
        }

        // Wait before retry with exponential backoff
        if (attempts < maxAttempts && this.retryConfig.enabled) {
          const delay = this.calculateBackoffDelay(attempts - 1);
          await this.sleep(delay);
        }
      }
    }

    this.logger.error('Email send failed after all attempts (SMTP)', {
      attempts,
      error: lastError?.message,
      to: this.maskEmail(this.formatAddresses(options.to)),
    });

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      attempts,
    };
  }

  // ============ Outlook / Graph API Methods ============

  private async sendViaOutlook(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!this.connectionService.isConnectedNow()) {
      return {
        success: false,
        error: 'Outlook email service is not available',
        attempts: 0,
      };
    }

    let lastError: Error | null = null;
    let attempts = 0;

    const maxAttempts = this.retryConfig.enabled ? this.retryConfig.maxAttempts : 1;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const accessToken = await this.connectionService.getAccessToken();
        const senderEmail = this.connectionService.getSenderEmail();
        const payload = this.buildGraphPayload(options);

        const response = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
        );

        if (!response.ok) {
          const errorBody = await response.text();
          const graphError = new Error(`Graph API error ${response.status}: ${errorBody}`);
          (graphError as any).statusCode = response.status;
          throw graphError;
        }

        this.logger.log('Email sent successfully via Outlook', {
          to: this.maskEmail(this.formatAddresses(options.to)),
          subject: options.subject.substring(0, 50),
          attempts,
        });

        return {
          success: true,
          messageId: undefined,
          accepted: this.extractAddresses(options.to),
          rejected: [],
          attempts,
          sentAt: new Date(),
        };
      } catch (error) {
        lastError = error as Error;

        this.logger.warn('Email send attempt failed (Outlook)', {
          attempt: attempts,
          maxAttempts,
          error: lastError.message,
        });

        if (this.isNonRetryableGraphError(lastError)) {
          break;
        }

        if (attempts < maxAttempts && this.retryConfig.enabled) {
          const delay = this.calculateBackoffDelay(attempts - 1);
          await this.sleep(delay);
        }
      }
    }

    this.logger.error('Email send failed after all attempts (Outlook)', {
      attempts,
      error: lastError?.message,
      to: this.maskEmail(this.formatAddresses(options.to)),
    });

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      attempts,
    };
  }

  private buildGraphPayload(options: SendEmailOptions): GraphPayload {
    const body = options.html
      ? { contentType: 'HTML', content: options.html }
      : { contentType: 'Text', content: options.text || '' };

    const message: GraphPayload['message'] = {
      subject: options.subject,
      body,
      toRecipients: this.toGraphRecipients(options.to),
    };

    if (options.cc) {
      message.ccRecipients = this.toGraphRecipients(options.cc);
    }

    if (options.bcc) {
      message.bccRecipients = this.toGraphRecipients(options.bcc);
    }

    if (options.replyTo) {
      message.replyTo = this.toGraphRecipients(options.replyTo);
    }

    if (options.priority) {
      const importanceMap: Record<string, string> = {
        high: 'high',
        normal: 'normal',
        low: 'low',
      };
      message.importance = importanceMap[options.priority] || 'normal';
    }

    if (options.headers) {
      message.internetMessageHeaders = Object.entries(options.headers).map(
        ([name, value]) => ({ name, value }),
      );
    }

    if (options.attachments && options.attachments.length > 0) {
      message.attachments = options.attachments
        .filter((att): att is EmailAttachment & { content: Buffer | string } => !!att.content)
        .map((att) => {
          const contentBytes = Buffer.isBuffer(att.content)
            ? att.content.toString('base64')
            : Buffer.from(att.content as string).toString('base64');

          const graphAtt: GraphAttachment = {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: att.filename,
            contentType: att.contentType || 'application/octet-stream',
            contentBytes,
          };

          if (att.cid) {
            graphAtt.contentId = att.cid;
            graphAtt.isInline = true;
          }

          return graphAtt;
        });
    }

    return {
      message,
      saveToSentItems: true,
    };
  }

  private toGraphRecipients(
    addresses: string | string[] | EmailAddress | EmailAddress[],
  ): GraphRecipient[] {
    const list = Array.isArray(addresses) ? addresses : [addresses];
    return list.map((addr) => {
      if (typeof addr === 'string') {
        return { emailAddress: { address: addr } };
      }
      return {
        emailAddress: {
          address: addr.address,
          ...(addr.name ? { name: addr.name } : {}),
        },
      };
    });
  }

  private isNonRetryableGraphError(error: Error): boolean {
    const statusCode = (error as any).statusCode;
    if (statusCode === 400 || statusCode === 401 || statusCode === 403) {
      return true;
    }
    return false;
  }

  private extractAddresses(
    addresses: string | string[] | EmailAddress | EmailAddress[],
  ): string[] {
    const list = Array.isArray(addresses) ? addresses : [addresses];
    return list.map((addr) => (typeof addr === 'string' ? addr : addr.address));
  }

  // ============ Shared Private Methods ============

  private formatAddress(address: string | EmailAddress): string {
    if (typeof address === 'string') {
      return address;
    }
    return address.name ? `"${address.name}" <${address.address}>` : address.address;
  }

  private formatAddresses(
    addresses: string | string[] | EmailAddress | EmailAddress[],
  ): string | string[] {
    if (Array.isArray(addresses)) {
      return addresses.map((addr) => this.formatAddress(addr));
    }
    return this.formatAddress(addresses);
  }

  private maskEmail(email: string | string[]): string {
    const mask = (e: string): string => {
      const addr = this.extractBracketedEmailAddress(e);
      const [local, domain] = addr.split('@');
      if (!domain) return '***';
      return `${local.substring(0, 2)}***@${domain}`;
    };

    if (Array.isArray(email)) {
      return email.map(mask).join(', ');
    }
    return mask(email);
  }

  /** Extracts the address from `"Name" <user@host>` or returns the input trimmed. */
  private extractBracketedEmailAddress(value: string): string {
    const start = value.indexOf('<');
    if (start === -1) {
      return value.trim();
    }
    const end = value.indexOf('>', start + 1);
    if (end === -1) {
      return value.trim();
    }
    return value.slice(start + 1, end).trim();
  }

  private isNonRetryableError(error: Error): boolean {
    const nonRetryablePatterns = [
      'Invalid login',
      'Authentication failed',
      'Invalid recipient',
      'Mailbox not found',
      'User unknown',
      'Recipient rejected',
    ];

    return nonRetryablePatterns.some((pattern) =>
      error.message.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  private calculateBackoffDelay(attempt: number): number {
    const { initialDelayMs, maxDelayMs, multiplier } = this.retryConfig;
    const jitter = randomBackoffJitter();
    const delay = initialDelayMs * Math.pow(multiplier, attempt) * jitter;
    return Math.min(delay, maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

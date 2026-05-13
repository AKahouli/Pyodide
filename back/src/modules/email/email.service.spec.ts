import { EmailService } from './email.service';
import { EmailConnectionService } from './email-connection.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';

describe('EmailService', () => {
  let service: EmailService;
  let mockConnectionService: jest.Mocked<EmailConnectionService>;
  let mockTransporter: { sendMail: jest.Mock };

  const createMockLogger = (): jest.Mocked<LoggerService> =>
    ({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }) as unknown as jest.Mocked<LoggerService>;

  const createMockConfig = (overrides: Record<string, unknown> = {}): ConfigService => {
    const defaults: Record<string, unknown> = {
      'email.from.name': 'TestApp',
      'email.from.address': 'test@example.com',
      'email.retry.enabled': false,
      'email.retry.maxAttempts': 3,
      'email.retry.initialDelayMs': 10,
      'email.retry.maxDelayMs': 100,
      'email.retry.multiplier': 2,
      ...overrides,
    };
    return {
      get: jest.fn((key: string, defaultValue?: unknown) => defaults[key] ?? defaultValue),
    } as unknown as ConfigService;
  };

  beforeEach(() => {
    mockTransporter = {
      sendMail: jest.fn().mockResolvedValue({
        messageId: '<msg-001@example.com>',
        accepted: ['user@example.com'],
        rejected: [],
      }),
    };

    mockConnectionService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getTransporter: jest.fn().mockReturnValue(mockTransporter),
      getProvider: jest.fn().mockReturnValue('smtp'),
      getSenderEmail: jest.fn().mockReturnValue('sender@company.com'),
      getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
      isConnectedNow: jest.fn().mockReturnValue(true),
      getHealthStatus: jest.fn().mockReturnValue({
        available: true,
        connected: true,
        error: null,
        reconnectAttempts: 0,
        isReconnecting: false,
      }),
    } as unknown as jest.Mocked<EmailConnectionService>;

    service = new EmailService(
      createMockConfig(),
      createMockLogger(),
      mockConnectionService,
    );
  });

  describe('isAvailable', () => {
    it('should delegate to connection service', () => {
      const result = service.isAvailable();

      expect(result).toBe(true);
      expect(mockConnectionService.isAvailable).toHaveBeenCalled();
    });

    it('should return false when connection service is unavailable', () => {
      mockConnectionService.isAvailable.mockReturnValue(false);

      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('should delegate to connection service', () => {
      const status = service.getHealthStatus();

      expect(status.available).toBe(true);
      expect(status.connected).toBe(true);
      expect(mockConnectionService.getHealthStatus).toHaveBeenCalled();
    });
  });

  describe('smtp provider', () => {
    describe('send', () => {
      it('should return error when transporter is not available', async () => {
        mockConnectionService.getTransporter.mockReturnValue(null);

        const result = await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hello',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Email service is not available');
        expect(result.attempts).toBe(0);
      });

      it('should send email successfully', async () => {
        const result = await service.send({
          to: 'user@example.com',
          subject: 'Test Subject',
          text: 'Hello World',
        });

        expect(result.success).toBe(true);
        expect(result.messageId).toBe('<msg-001@example.com>');
        expect(result.accepted).toEqual(['user@example.com']);
        expect(result.rejected).toEqual([]);
        expect(result.attempts).toBe(1);
        expect(result.sentAt).toBeInstanceOf(Date);
      });

      it('should use default from address', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            from: '"TestApp" <test@example.com>',
          }),
        );
      });

      it('should allow overriding from address', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          from: { name: 'Custom', address: 'custom@example.com' },
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            from: '"Custom" <custom@example.com>',
          }),
        );
      });

      it('should format string from address as-is', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          from: 'plain@example.com',
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            from: 'plain@example.com',
          }),
        );
      });

      it('should pass subject, text, and html', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'My Subject',
          text: 'Plain text',
          html: '<p>HTML</p>',
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            subject: 'My Subject',
            text: 'Plain text',
            html: '<p>HTML</p>',
          }),
        );
      });

      it('should pass cc, bcc, replyTo', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
          replyTo: 'reply@example.com',
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            cc: 'cc@example.com',
            bcc: 'bcc@example.com',
            replyTo: 'reply@example.com',
          }),
        );
      });

      it('should pass priority and custom headers', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          priority: 'high',
          headers: { 'X-Custom': 'value' },
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            priority: 'high',
            headers: { 'X-Custom': 'value' },
          }),
        );
      });

      it('should pass attachments', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          attachments: [
            { filename: 'report.pdf', content: Buffer.from('data'), contentType: 'application/pdf' },
          ],
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            attachments: [
              expect.objectContaining({
                filename: 'report.pdf',
                contentType: 'application/pdf',
              }),
            ],
          }),
        );
      });

      it('should format EmailAddress recipients', async () => {
        await service.send({
          to: { name: 'John', address: 'john@example.com' },
          subject: 'Test',
          text: 'Hi',
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: '"John" <john@example.com>',
          }),
        );
      });

      it('should format array of recipients', async () => {
        await service.send({
          to: ['a@example.com', 'b@example.com'],
          subject: 'Test',
          text: 'Hi',
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: ['a@example.com', 'b@example.com'],
          }),
        );
      });

      it('should format array of EmailAddress recipients', async () => {
        await service.send({
          to: [
            { name: 'Alice', address: 'alice@example.com' },
            { address: 'bob@example.com' },
          ],
          subject: 'Test',
          text: 'Hi',
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: ['"Alice" <alice@example.com>', 'bob@example.com'],
          }),
        );
      });

      it('should return failure on send error (retry disabled)', async () => {
        mockTransporter.sendMail.mockRejectedValue(new Error('Connection timeout'));

        const result = await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Connection timeout');
        expect(result.attempts).toBe(1);
      });

      it('should omit cc/bcc/replyTo when not provided', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            cc: undefined,
            bcc: undefined,
            replyTo: undefined,
          }),
        );
      });
    });

    describe('send with retry', () => {
      let retryService: EmailService;

      beforeEach(() => {
        retryService = new EmailService(
          createMockConfig({ 'email.retry.enabled': true }),
          createMockLogger(),
          mockConnectionService,
        );
      });

      it('should retry on transient errors', async () => {
        mockTransporter.sendMail
          .mockRejectedValueOnce(new Error('Connection reset'))
          .mockResolvedValueOnce({
            messageId: '<retry-ok@example.com>',
            accepted: ['user@example.com'],
            rejected: [],
          });

        const result = await retryService.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(2);
        expect(mockTransporter.sendMail).toHaveBeenCalledTimes(2);
      });

      it('should not retry on authentication errors', async () => {
        mockTransporter.sendMail.mockRejectedValue(new Error('Invalid login'));

        const result = await retryService.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1);
        expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
      });

      it('should not retry on invalid recipient errors', async () => {
        mockTransporter.sendMail.mockRejectedValue(new Error('Recipient rejected'));

        const result = await retryService.send({
          to: 'bad@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1);
      });

      it('should not retry on mailbox not found', async () => {
        mockTransporter.sendMail.mockRejectedValue(new Error('Mailbox not found'));

        const result = await retryService.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1);
      });

      it('should exhaust max attempts on persistent errors', async () => {
        mockTransporter.sendMail.mockRejectedValue(new Error('SMTP timeout'));

        const result = await retryService.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(3);
        expect(mockTransporter.sendMail).toHaveBeenCalledTimes(3);
      });
    });

    describe('sendBulk', () => {
      it('should send all emails and return summary', async () => {
        const result = await service.sendBulk({
          emails: [
            { to: 'a@example.com', subject: 'A', text: 'A' },
            { to: 'b@example.com', subject: 'B', text: 'B' },
            { to: 'c@example.com', subject: 'C', text: 'C' },
          ],
        });

        expect(result.total).toBe(3);
        expect(result.successful).toBe(3);
        expect(result.failed).toBe(0);
        expect(result.results).toHaveLength(3);
      });

      it('should continue on error by default', async () => {
        mockTransporter.sendMail
          .mockResolvedValueOnce({ messageId: '1', accepted: [], rejected: [] })
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce({ messageId: '3', accepted: [], rejected: [] });

        const result = await service.sendBulk({
          emails: [
            { to: 'a@example.com', subject: 'A', text: 'A' },
            { to: 'b@example.com', subject: 'B', text: 'B' },
            { to: 'c@example.com', subject: 'C', text: 'C' },
          ],
        });

        expect(result.total).toBe(3);
        expect(result.successful).toBe(2);
        expect(result.failed).toBe(1);
        expect(result.results).toHaveLength(3);
      });

      it('should stop on first error when stopOnError is true', async () => {
        mockTransporter.sendMail
          .mockResolvedValueOnce({ messageId: '1', accepted: [], rejected: [] })
          .mockRejectedValueOnce(new Error('fail'));

        const result = await service.sendBulk({
          emails: [
            { to: 'a@example.com', subject: 'A', text: 'A' },
            { to: 'b@example.com', subject: 'B', text: 'B' },
            { to: 'c@example.com', subject: 'C', text: 'C' },
          ],
          stopOnError: true,
        });

        expect(result.total).toBe(3);
        expect(result.successful).toBe(1);
        expect(result.failed).toBe(1);
        expect(result.results).toHaveLength(2);
      });

      it('should handle empty emails array', async () => {
        const result = await service.sendBulk({ emails: [] });

        expect(result.total).toBe(0);
        expect(result.successful).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.results).toHaveLength(0);
      });
    });

    describe('sendText', () => {
      it('should send a plain text email', async () => {
        const result = await service.sendText('user@example.com', 'Subject', 'Hello');

        expect(result.success).toBe(true);
        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'user@example.com',
            subject: 'Subject',
            text: 'Hello',
          }),
        );
      });
    });

    describe('sendHtml', () => {
      it('should send an HTML email', async () => {
        const result = await service.sendHtml('user@example.com', 'Subject', '<p>Hi</p>');

        expect(result.success).toBe(true);
        expect(mockTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'user@example.com',
            subject: 'Subject',
            html: '<p>Hi</p>',
          }),
        );
      });
    });
  });

  describe('outlook provider', () => {
    let mockFetch: jest.Mock;

    beforeEach(() => {
      mockConnectionService.getProvider.mockReturnValue('outlook');
      mockConnectionService.getTransporter.mockReturnValue(null);

      mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 202,
        text: jest.fn().mockResolvedValue(''),
      });
      global.fetch = mockFetch;
    });

    afterEach(() => {
      delete (global as any).fetch;
    });

    describe('send', () => {
      it('should send email via Graph API', async () => {
        const result = await service.send({
          to: 'user@example.com',
          subject: 'Test Subject',
          html: '<p>Hello</p>',
        });

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(1);
        expect(result.accepted).toEqual(['user@example.com']);
        expect(result.sentAt).toBeInstanceOf(Date);

        expect(mockFetch).toHaveBeenCalledWith(
          'https://graph.microsoft.com/v1.0/users/sender%40company.com/sendMail',
          expect.objectContaining({
            method: 'POST',
            headers: {
              Authorization: 'Bearer mock-access-token',
              'Content-Type': 'application/json',
            },
          }),
        );
      });

      it('should build correct Graph API payload for HTML email', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hello</p>',
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.subject).toBe('Test');
        expect(body.message.body).toEqual({ contentType: 'HTML', content: '<p>Hello</p>' });
        expect(body.message.toRecipients).toEqual([
          { emailAddress: { address: 'user@example.com' } },
        ]);
        expect(body.saveToSentItems).toBe(true);
      });

      it('should build correct Graph API payload for text email', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Plain text',
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.body).toEqual({ contentType: 'Text', content: 'Plain text' });
      });

      it('should include cc, bcc, and replyTo recipients', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          cc: 'cc@example.com',
          bcc: ['bcc1@example.com', 'bcc2@example.com'],
          replyTo: 'reply@example.com',
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.ccRecipients).toEqual([
          { emailAddress: { address: 'cc@example.com' } },
        ]);
        expect(body.message.bccRecipients).toEqual([
          { emailAddress: { address: 'bcc1@example.com' } },
          { emailAddress: { address: 'bcc2@example.com' } },
        ]);
        expect(body.message.replyTo).toEqual([
          { emailAddress: { address: 'reply@example.com' } },
        ]);
      });

      it('should map priority to importance', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          priority: 'high',
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.importance).toBe('high');
      });

      it('should include custom headers as internetMessageHeaders', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          headers: { 'X-Custom': 'value', 'X-Another': 'test' },
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.internetMessageHeaders).toEqual([
          { name: 'X-Custom', value: 'value' },
          { name: 'X-Another', value: 'test' },
        ]);
      });

      it('should include attachments with base64 content', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
          attachments: [
            {
              filename: 'report.pdf',
              content: Buffer.from('pdf-data'),
              contentType: 'application/pdf',
            },
          ],
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.attachments).toEqual([
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'report.pdf',
            contentType: 'application/pdf',
            contentBytes: Buffer.from('pdf-data').toString('base64'),
          },
        ]);
      });

      it('should include inline attachments with contentId', async () => {
        await service.send({
          to: 'user@example.com',
          subject: 'Test',
          html: '<img src="cid:logo">',
          attachments: [
            {
              filename: 'logo.png',
              content: Buffer.from('png-data'),
              contentType: 'image/png',
              cid: 'logo',
            },
          ],
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.attachments[0].contentId).toBe('logo');
        expect(body.message.attachments[0].isInline).toBe(true);
      });

      it('should handle EmailAddress recipients', async () => {
        await service.send({
          to: [
            { name: 'Alice', address: 'alice@example.com' },
            { address: 'bob@example.com' },
          ],
          subject: 'Test',
          text: 'Hi',
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.toRecipients).toEqual([
          { emailAddress: { address: 'alice@example.com', name: 'Alice' } },
          { emailAddress: { address: 'bob@example.com' } },
        ]);
      });

      it('should return error when not connected', async () => {
        mockConnectionService.isConnectedNow.mockReturnValue(false);

        const result = await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Outlook email service is not available');
        expect(result.attempts).toBe(0);
      });

      it('should handle Graph API error response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          text: jest.fn().mockResolvedValue('Internal Server Error'),
        });

        const result = await service.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Graph API error 500');
      });

      it('should not retry on 401 errors', async () => {
        const retryService = new EmailService(
          createMockConfig({ 'email.retry.enabled': true }),
          createMockLogger(),
          mockConnectionService,
        );

        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
          text: jest.fn().mockResolvedValue('Unauthorized'),
        });

        const result = await retryService.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should not retry on 403 errors', async () => {
        const retryService = new EmailService(
          createMockConfig({ 'email.retry.enabled': true }),
          createMockLogger(),
          mockConnectionService,
        );

        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          text: jest.fn().mockResolvedValue('Forbidden'),
        });

        const result = await retryService.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1);
      });

      it('should not retry on 400 errors', async () => {
        const retryService = new EmailService(
          createMockConfig({ 'email.retry.enabled': true }),
          createMockLogger(),
          mockConnectionService,
        );

        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          text: jest.fn().mockResolvedValue('Bad Request'),
        });

        const result = await retryService.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1);
      });

      it('should retry on 500 errors when retry is enabled', async () => {
        const retryService = new EmailService(
          createMockConfig({ 'email.retry.enabled': true }),
          createMockLogger(),
          mockConnectionService,
        );

        mockFetch
          .mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: jest.fn().mockResolvedValue('Server Error'),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 202,
            text: jest.fn().mockResolvedValue(''),
          });

        const result = await retryService.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hi',
        });

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(2);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('sendBulk', () => {
      it('should send all emails via outlook and return summary', async () => {
        const result = await service.sendBulk({
          emails: [
            { to: 'a@example.com', subject: 'A', text: 'A' },
            { to: 'b@example.com', subject: 'B', text: 'B' },
          ],
        });

        expect(result.total).toBe(2);
        expect(result.successful).toBe(2);
        expect(result.failed).toBe(0);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('sendText', () => {
      it('should send a plain text email via outlook', async () => {
        const result = await service.sendText('user@example.com', 'Subject', 'Hello');

        expect(result.success).toBe(true);
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.body).toEqual({ contentType: 'Text', content: 'Hello' });
      });
    });

    describe('sendHtml', () => {
      it('should send an HTML email via outlook', async () => {
        const result = await service.sendHtml('user@example.com', 'Subject', '<p>Hi</p>');

        expect(result.success).toBe(true);
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.message.body).toEqual({ contentType: 'HTML', content: '<p>Hi</p>' });
      });
    });
  });
});

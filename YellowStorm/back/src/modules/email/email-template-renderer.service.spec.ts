import { EmailTemplateRenderer } from './email-template-renderer.service';
import { EmailTemplate } from './email-template.constants';
import { join } from 'path';
import { existsSync } from 'fs';

describe('EmailTemplateRenderer', () => {
  const makeConfig = (logoUrl = '') => ({
    get: jest.fn((key: string, def: unknown) => {
      if (key === 'email.templates.logoUrl') return logoUrl;
      return def;
    }),
  });

  const makeLogger = () => ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  });

  const createRenderer = (logoUrl = '') => {
    const config = makeConfig(logoUrl);
    const logger = makeLogger();
    return {
      renderer: new EmailTemplateRenderer(config as never, logger as never),
      config,
      logger,
    };
  };

  beforeAll(() => {
    const templatesDir = join(process.cwd(), 'src', 'modules', 'email', 'templates');
    const [marker] = Object.values(EmailTemplate);
    expect(existsSync(join(templatesDir, `${marker}.html`))).toBe(true);
  });

  it('substitutes all variables and adds the current year', () => {
    const { renderer } = createRenderer();
    const result = renderer.render(EmailTemplate.PASSWORD_RESET, {
      appUrl: 'http://localhost:5173',
      appName: 'YelloStorm',
      resetUrl: 'http://localhost:5173/#/reset-password?token=abc123',
      passwordResetExpiryHours: '2',
      passwordResetExpirySuffix: 's',
    });

    expect(result.html).toContain('YelloStorm');
    expect(result.html).toContain('http://localhost:5173/#/reset-password?token=abc123');
    expect(result.html).toContain('This link will expire in 2 hours.');
    expect(result.html).toContain(`<p style="margin:16px 0 0 0; font-size:11px; line-height:1.5; color:#A6ACB4;">&copy; ${new Date().getFullYear()} YellowMind. All rights reserved.</p>`);
    expect(result.html).not.toContain('{{');
    expect(result.subject).toContain('Reset your password - YelloStorm');
  });

  it('singularizes the expiry suffix for one hour', () => {
    const { renderer } = createRenderer();
    const result = renderer.render(EmailTemplate.PASSWORD_RESET, {
      appUrl: 'http://localhost:5173',
      appName: 'YelloStorm',
      resetUrl: 'http://localhost:5173/#/reset-password?token=abc',
      passwordResetExpiryHours: '1',
      passwordResetExpirySuffix: '',
    });

    expect(result.html).toContain('This link will expire in 1 hour.');
  });

  it('escapes user-supplied values in the HTML body', () => {
    const { renderer } = createRenderer();
    const result = renderer.render(EmailTemplate.REGISTRATION_PENDING_ADMIN, {
      appName: 'YelloStorm',
      applicantEmail: 'a&b"c@acme.io',
      requestedAt: '02/09/2026 à 14:00',
      usersAdminUrl: 'http://localhost:5173/#/admin/users',
    });

    expect(result.html).toContain('a&amp;b&quot;c@acme.io');
    expect(result.html).not.toContain('a&b"c@acme.io');
  });

  it('renders the requestedAt date as provided', () => {
    const { renderer } = createRenderer();
    const result = renderer.render(EmailTemplate.REGISTRATION_PENDING_ADMIN, {
      appName: 'YelloStorm',
      applicantEmail: 'jane@acme.io',
      requestedAt: '02/09/2026 à 14:00',
      usersAdminUrl: 'http://localhost:5173/#/admin/users',
    });

    expect(result.html).toContain('02/09/2026 à 14:00');
    expect(result.subject).toContain('New registration request');
  });

  it('generates a plain-text version without HTML tags', () => {
    const { renderer } = createRenderer();
    const result = renderer.render(EmailTemplate.REGISTRATION_APPROVED, {
      appName: 'YelloStorm',
      loginUrl: 'http://localhost:5173/#/',
    });

    expect(result.text).toBeDefined();
    expect(result.text).not.toMatch(/<[^>]+>/);
    expect(result.text).toContain('http://localhost:5173/#/');
  });

  it('embeds the bundled logo inline via CID when no absolute logo URL is configured', () => {
    const { renderer } = createRenderer('');
    const result = renderer.render(EmailTemplate.VERIFY_EMAIL, {
      appUrl: 'http://localhost:5173',
      appName: 'YelloStorm',
      verificationUrl: 'http://localhost:5173/#/verify-email?token=abc',
    });

    expect(result.html).toContain('src="cid:yellowmind-logo"');
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0]).toMatchObject({
      filename: 'yellowmind.png',
      contentType: 'image/png',
      cid: 'yellowmind-logo',
    });
    expect(result.attachments![0].content).toBeInstanceOf(Buffer);
  });

  it('uses a configured absolute logo URL and omits the inline attachment', () => {
    const { renderer } = createRenderer('https://cdn.example.com/yellowmind.png');
    const result = renderer.render(EmailTemplate.VERIFY_EMAIL, {
      appUrl: 'http://localhost:5173',
      appName: 'YelloStorm',
      verificationUrl: 'http://localhost:5173/#/verify-email?token=abc',
    });

    expect(result.html).toContain('src="https://cdn.example.com/yellowmind.png"');
    expect(result.attachments).toBeUndefined();
  });

  it('keeps unknown placeholders in the subject (non-strict)', () => {
    const { renderer } = createRenderer();
    const result = renderer.render(EmailTemplate.LINK_OAUTH_ACCOUNT, {
      appName: 'YelloStorm',
      linkUrl: 'http://localhost:3000/api/v1/auth/providers/link/verify?token=x',
    });

    expect(result.subject).toContain('{{providerKey}}');
  });

  it('throws on an unknown template key', () => {
    const { renderer } = createRenderer();
    expect(() => renderer.render('nope' as EmailTemplate, {})).toThrow(/Unknown email template/);
  });
});
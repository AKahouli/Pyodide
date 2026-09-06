import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';
import { LoggerService } from '@modules/logger';
import { EmailAttachment } from './interfaces/email.interface';
import {
  EMAIL_TEMPLATES,
  EMAIL_TEMPLATES_DIR,
  EMAIL_ASSETS_DIR,
  EMAIL_IMAGES_DIR,
  LOGO_FILE,
  LOGO_CID,
  EmailTemplate,
} from './email-template.constants';

export interface RenderEmailTemplateResult {
  subject: string;
  html: string;
  text?: string;
  /** Inline attachment for the header logo when it is embedded via CID. */
  attachments?: EmailAttachment[];
}

const PLACEHOLDER_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Renders transactional emails from standalone HTML template documents.
 *
 * Each template lives in `templates/` and is a complete, self-contained email
 * (header, CTA, footer) whose design is used verbatim. Services own the
 * business logic and provide plain data for the `{{variable}}` placeholders;
 * this renderer substitutes them, generates a plain-text alternative and keeps
 * a cache so templates are read from disk once.
 *
 * The header logo is attached inline via `cid:yellowmind-logo` (the most
 * reliable way to display it across mail clients, since remote images and SVG
 * are frequently blocked). Set `email.templates.logoUrl` to use an absolute
 * public URL (e.g. a CDN) instead.
 */
@Injectable()
export class EmailTemplateRenderer {
  public readonly templatesDir: string;
  public readonly assetsImagesDir: string;
  private readonly cache = new Map<string, string>();
  private logoAttachment: EmailAttachment | null | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EmailTemplateRenderer.name);
    this.templatesDir = this.resolveTemplatesDir();
    this.assetsImagesDir = this.resolveAssetsImagesDir();
  }

  render(templateKey: EmailTemplate, data: Record<string, string>): RenderEmailTemplateResult {
    const config = EMAIL_TEMPLATES[templateKey];
    if (!config) {
      throw new Error(`Unknown email template key: ${String(templateKey)}`);
    }

    const template = this.loadOnce(config.file);
    const logo = this.logo();

    const vars: Record<string, string> = {
      ...data,
      logoSrc: logo.path,
      appUrl: data.appUrl ?? '',
      year: String(new Date().getFullYear()),
    };

    const html = this.substitute(template, vars);
    const subject = this.substitute(config.subject, data, { strict: false, escape: false });
    const text = this.toPlainText(html);

    return {
      subject,
      html,
      text,
      ...(logo.attachment ? { attachments: [logo.attachment] } : {}),
    };
  }

  private substitute(
    template: string,
    vars: Record<string, string>,
    options: { strict?: boolean; escape?: boolean } = {},
  ): string {
    const { strict = true, escape = true } = options;
    return template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
      const value = vars[key];
      if (value === undefined) {
        this.logMissingVariable(key);
        if (strict) {
          return '';
        }
        return match;
      }
      return escape ? this.escapeHtml(value) : value;
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Derives a plain-text alternative from the rendered HTML. */
  private toPlainText(html: string): string {
    return html
      .replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->|<!--\[if !mso\]><!-->|<!--<!\[endif\]-->/g, '')
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|table|tr|li|ul|center|hr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private loadOnce(fileName: string): string {
    const cached = this.cache.get(fileName);
    if (cached !== undefined) {
      return cached;
    }

    const filePath = this.templatePath(fileName);
    try {
      const content = readFileSync(filePath, 'utf8');
      this.cache.set(fileName, content);
      return content;
    } catch (error) {
      this.logger.error('Failed to load email template', {
        template: fileName,
        path: filePath,
        error: (error as Error).message,
      });
      throw new Error(`Email template not found: ${fileName} (looked in ${filePath})`);
    }
  }

  private templatePath(fileName: string): string {
    return join(this.templatesDir, fileName);
  }

  private logo(): { path: string; attachment?: EmailAttachment } {
    const configured = this.configService.get<string>('email.templates.logoUrl', '');
    if (/^https?:\/\//i.test(configured)) {
      return { path: configured };
    }

    const attachment = this.loadLogoAttachment();
    if (attachment) {
      return { path: `cid:${LOGO_CID}`, attachment };
    }

    // No public URL configured and the bundled logo is unavailable (e.g. a
    // missing build asset): degrade gracefully, an error was already logged.
    return { path: '' };
  }

  private loadLogoAttachment(): EmailAttachment | null {
    if (this.logoAttachment !== undefined) {
      return this.logoAttachment;
    }

    const filePath = join(this.assetsImagesDir, LOGO_FILE);
    try {
      const content = readFileSync(filePath);
      this.logoAttachment = {
        filename: LOGO_FILE,
        content,
        contentType: 'image/png',
        cid: LOGO_CID,
      };
      return this.logoAttachment;
    } catch (error) {
      this.logger.error('Failed to load email logo', {
        path: filePath,
        error: (error as Error).message,
      });
      this.logoAttachment = null;
      return null;
    }
  }

  private resolveTemplatesDir(): string {
    const candidates = this.candidateTemplateDirs();
    const marker = EMAIL_TEMPLATES[EmailTemplate.PASSWORD_RESET].file;

    for (const candidate of candidates) {
      if (existsSync(join(candidate, marker))) {
        this.logMissingTemplateFiles(candidate);
        this.logger.log('Email templates directory resolved', { path: candidate });
        return candidate;
      }
    }

    this.logger.error('No candidate directory contains email template files', { candidates });
    return candidates[0];
  }

  private candidateTemplateDirs(): string[] {
    const configured = this.configService.get<string>('email.templates.dir', '');
    const candidates: string[] = [];

    if (configured) {
      const absolute = isAbsolute(configured)
        ? configured
        : resolve(process.cwd(), configured);
      candidates.push(absolute);
    }

    candidates.push(join(__dirname, EMAIL_TEMPLATES_DIR));

    const mainEntry = require.main?.filename;
    if (mainEntry) {
      candidates.push(join(dirname(mainEntry), 'modules', 'email', EMAIL_TEMPLATES_DIR));
    }

    candidates.push(join(process.cwd(), 'dist', 'modules', 'email', EMAIL_TEMPLATES_DIR));
    candidates.push(join(process.cwd(), 'src', 'modules', 'email', EMAIL_TEMPLATES_DIR));
    candidates.push(resolve(process.cwd(), EMAIL_TEMPLATES_DIR));

    return [...new Set(candidates)];
  }

  private resolveAssetsImagesDir(): string {
    const candidates = this.candidateAssetsImagesDirs();

    for (const candidate of candidates) {
      if (existsSync(join(candidate, LOGO_FILE))) {
        this.logger.log('Email assets images directory resolved', { path: candidate });
        return candidate;
      }
    }

    this.logger.error('No candidate directory contains the email logo file', { candidates });
    return join(this.templatesDir, '..', EMAIL_ASSETS_DIR, EMAIL_IMAGES_DIR);
  }

  private candidateAssetsImagesDirs(): string[] {
    const candidates = [
      join(this.templatesDir, '..', EMAIL_ASSETS_DIR, EMAIL_IMAGES_DIR),
      join(__dirname, EMAIL_ASSETS_DIR, EMAIL_IMAGES_DIR),
    ];

    const mainEntry = require.main?.filename;
    if (mainEntry) {
      candidates.push(
        join(dirname(mainEntry), 'modules', 'email', EMAIL_ASSETS_DIR, EMAIL_IMAGES_DIR),
      );
    }

    candidates.push(
      join(process.cwd(), 'dist', 'modules', 'email', EMAIL_ASSETS_DIR, EMAIL_IMAGES_DIR),
    );
    candidates.push(
      join(process.cwd(), 'src', 'modules', 'email', EMAIL_ASSETS_DIR, EMAIL_IMAGES_DIR),
    );
    candidates.push(resolve(process.cwd(), EMAIL_ASSETS_DIR, EMAIL_IMAGES_DIR));

    return [...new Set(candidates)];
  }

  private logMissingTemplateFiles(dir: string): void {
    const required = Object.values(EMAIL_TEMPLATES).map((config) => config.file);
    const missing = required.filter((file) => !existsSync(join(dir, file)));
    if (missing.length > 0) {
      this.logger.warn('Email templates dir is missing some template files', {
        path: dir,
        missing,
      });
    }
  }

  private logMissingVariable(key: string): void {
    this.logger.warn('Missing variable while rendering email template', { key });
  }
}
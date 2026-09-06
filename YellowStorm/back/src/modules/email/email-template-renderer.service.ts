import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';
import { LoggerService } from '@modules/logger';
import { SystemService } from '@modules/system/system.service';
import { EmailAttachment } from './interfaces/email.interface';
import {
  EMAIL_TEMPLATES,
  EMAIL_TEMPLATES_DIR,
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
 * The header logo is shown only when an admin has uploaded one (attached
 * inline via `cid:yellowmind-logo`, the most reliable way to display it across
 * mail clients) or when `email.templates.logoUrl` points to an absolute public
 * URL (e.g. a CDN). Otherwise no logo is rendered.
 */
@Injectable()
export class EmailTemplateRenderer {
  public readonly templatesDir: string;
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly systemService: SystemService,
  ) {
    this.logger.setContext(EmailTemplateRenderer.name);
    this.templatesDir = this.resolveTemplatesDir();
  }

  async render(
    templateKey: EmailTemplate,
    data: Record<string, string>,
  ): Promise<RenderEmailTemplateResult> {
    const config = EMAIL_TEMPLATES[templateKey];
    if (!config) {
      throw new Error(`Unknown email template key: ${String(templateKey)}`);
    }

    let template = this.loadOnce(config.file);
    const logo = await this.logo();

    // When no logo is configured, drop the header logo block entirely instead
    // of emitting a broken `<img src="">` on the dark header background.
    if (logo.remove) {
      template = template.replace(
        /<a\b[^>]*>\s*<img\s+src="\{\{\s*logoSrc\s*\}\}"[^>]*>\s*<\/a>/gi,
        '',
      );
    }

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

  private async logo(): Promise<{
    path: string;
    attachment?: EmailAttachment;
    remove?: boolean;
  }> {
    // 1. Admin-configured logo (Appearance page) takes precedence.
    try {
      const custom = await this.systemService.getEmailLogo();
      if (custom) {
        return {
          path: `cid:${LOGO_CID}`,
          attachment: {
            filename: custom.filename,
            content: Buffer.from(custom.data, 'base64'),
            contentType: custom.contentType,
            cid: LOGO_CID,
          },
        };
      }
    } catch (error) {
      this.logger.warn('Failed to load admin email logo', {
        error: (error as Error).message,
      });
    }

    // 2. Absolute public URL override (legacy env escape hatch).
    const configured = this.configService.get<string>('email.templates.logoUrl', '');
    if (/^https?:\/\//i.test(configured)) {
      return { path: configured };
    }

    // 3. No default logo: omit it rather than embedding a build asset.
    return { path: '', remove: true };
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
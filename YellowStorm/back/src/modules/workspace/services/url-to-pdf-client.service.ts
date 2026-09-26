import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger';

@Injectable()
export class UrlToPdfClientService {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('UrlToPdfClientService');
    this.apiUrl = this.configService.get<string>('indexing.urlToPdfApiUrl', 'http://localhost:5000');
    this.apiKey = this.configService.get<string>('indexing.urlToPdfApiKey', '');
  }

  async convert(url: string, filename: string): Promise<Buffer> {
    // Sent as x-www-form-urlencoded form fields; booleans are hardcoded true
    // and serialized as the strings 'true' (which the API parses as booleans).
    const body = new URLSearchParams();
    body.append('url', url);
    body.append('filename', filename);
    body.append('print_background', 'true');
    body.append('prefer_css_page_size', 'true');

    const headers: Record<string, string> = {
      // The upstream Gotenberg-wrapper endpoint consumes
      // application/x-www-form-urlencoded, not JSON.
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}/convert-url-pdf`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    if (!res.ok) {
      const data = await res.text().catch(() => '');
      const message = `URL-to-PDF API error: ${res.status} - ${JSON.stringify(data) || 'request failed'}`;
      this.logger.error(message, { url, status: res.status });
      throw new Error(message);
    }

    return Buffer.from(await res.arrayBuffer());
  }
}

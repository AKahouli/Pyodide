import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { LoggerService } from '../../logger';

@Injectable()
export class UrlToPdfClientService {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('UrlToPdfClientService');
    this.apiUrl = this.configService.get<string>('indexing.urlToPdfApiUrl', 'http://localhost:5000');
    this.apiKey = this.configService.get<string>('indexing.urlToPdfApiKey', '');

    // The upstream Gotenberg-wrapper endpoint consumes
    // application/x-www-form-urlencoded, not JSON.
    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120_000,
    });

    this.httpClient.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers['x-api-key'] = this.apiKey;
      }
      return config;
    });
  }

  async convert(url: string, filename: string): Promise<Buffer> {
    // Sent as x-www-form-urlencoded form fields; booleans are hardcoded true
    // and serialized as the strings 'true' (which the API parses as booleans).
    const body = new URLSearchParams();
    body.append('url', url);
    body.append('filename', filename);
    body.append('print_background', 'true');
    body.append('prefer_css_page_size', 'true');

    try {
      const response = await this.httpClient.post('/convert-url-pdf', body, {
        responseType: 'arraybuffer',
      });
      return Buffer.from(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message = `URL-to-PDF API error: ${status} - ${JSON.stringify(data) || error.message}`;
        this.logger.error(message, { url, status });
        throw new Error(message);
      }
      throw error;
    }
  }
}

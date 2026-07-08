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

    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      headers: { 'Content-Type': 'application/json' },
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
    try {
      const response = await this.httpClient.post(
        '/convert-url-pdf',
        {
          url,
          filename,
          print_background: true,
          prefer_css_page_size: true,
        },
        { responseType: 'arraybuffer' },
      );
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

import { Injectable } from '@nestjs/common';
import { AxiosError, AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { UserDocument } from '../user/schemas/user.schema';
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { AI_PROXY_REQUEST_TIMEOUT_MS } from './constants/ai-proxy.constants';
import { ChatCompletionDto } from './dto/chat-completion.dto';
import { LiteLlmErrorResponse } from './interfaces/ai-proxy.interface';

@Injectable()
export class AiProxyStreamService {
  private readonly appBuilderApiKey: string;

  constructor(
    private readonly connectionService: LiteLLMConnectionService,
    private readonly configService: ConfigService,
  ) {
    this.appBuilderApiKey = this.configService.get<string>('litellm.appBuilderApiKey', '');
  }

  async streamChatCompletion(
    request: Request,
    response: Response,
    body: ChatCompletionDto,
    user: UserDocument,
  ): Promise<void> {
    const httpClient = this.connectionService.getHttpClient();
    if (!httpClient || !this.appBuilderApiKey) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      );
    }

    const abortController = new AbortController();
    let upstreamStream: Readable | null = null;
    let clientClosed = false;
    let doneMarkerSeen = false;
    let scanTail = '';

    const closeUpstream = (): void => {
      if (upstreamStream && !upstreamStream.destroyed) {
        upstreamStream.destroy();
      }
      abortController.abort();
    };

    const onClientClose = (): void => {
      clientClosed = true;
      closeUpstream();
    };

    request.once('aborted', onClientClose);
    response.once('close', onClientClose);

    const cleanup = (): void => {
      request.removeListener('aborted', onClientClose);
      response.removeListener('close', onClientClose);
    };

    try {
      const upstreamResponse = await this.requestStream(
        httpClient,
        body,
        user,
        abortController.signal,
      );
      upstreamStream = upstreamResponse.data as Readable;

      if (clientClosed || response.destroyed || response.writableEnded) {
        closeUpstream();
        return;
      }

      response.status(200);
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders?.();

      upstreamStream.on('data', (chunk: Buffer | string) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
        scanTail = `${scanTail}${text}`.slice(-32);
        if (scanTail.includes('data: [DONE]')) {
          doneMarkerSeen = true;
        }
      });

      upstreamStream.once('error', (error: Error) => {
        cleanup();
        if (!response.destroyed && !response.writableEnded) {
          response.destroy(error);
        }
      });

      upstreamStream.once('end', () => {
        cleanup();
        if (!doneMarkerSeen && !response.destroyed && !response.writableEnded) {
          response.end();
        }
      });

      upstreamStream.pipe(response as unknown as NodeJS.WritableStream);
    } catch (error) {
      cleanup();
      closeUpstream();
      if (clientClosed || response.headersSent) {
        return;
      }
      throw this.mapUpstreamError(error);
    }
  }

  private async requestStream(
    httpClient: AxiosInstance,
    body: ChatCompletionDto,
    user: UserDocument,
    signal: AbortSignal,
  ) {
    return httpClient.post<Readable>(
      '/v1/chat/completions',
      { ...body, stream: true },
      {
        headers: {
          Authorization: `Bearer ${this.appBuilderApiKey}`,
          'X-Request-User': user._id.toString(),
        },
        responseType: 'stream',
        timeout: AI_PROXY_REQUEST_TIMEOUT_MS,
        signal,
      },
    );
  }

  private mapUpstreamError(error: unknown): Error {
    if (!(error instanceof AxiosError)) {
      return new BadGatewayException(
        ErrorCode.CHAT_COMPLETION_FAILED,
        'AI provider stream failed',
      );
    }

    const upstreamMessage = (error.response?.data as LiteLlmErrorResponse | undefined)
      ?.error?.message;
    if (
      !error.response
      && error.code !== 'ERR_CANCELED'
      && error.code !== 'ECONNABORTED'
      && error.code !== 'ETIMEDOUT'
    ) {
      return new ServiceUnavailableException(
        ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      );
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ServiceUnavailableException(
        ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      );
    }

    return new BadGatewayException(
      ErrorCode.CHAT_COMPLETION_FAILED,
      upstreamMessage || 'AI provider stream failed',
    );
  }
}

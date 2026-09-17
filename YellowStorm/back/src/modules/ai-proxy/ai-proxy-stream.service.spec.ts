import { AxiosError, AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Request, Response } from 'express';
import { AiProxyStreamService } from './ai-proxy-stream.service';
import { AI_PROXY_REQUEST_TIMEOUT_MS } from './constants/ai-proxy.constants';
import { ChatCompletionDto, ChatMessageRole } from './dto/chat-completion.dto';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { UserDocument } from '../user/schemas/user.schema';
import { AiProxyUsageService } from './ai-proxy-usage.service';

describe('AiProxyStreamService', () => {
  let stream: PassThrough;
  const post = jest.fn();
  const connectionService = {
    getHttpClient: jest.fn(),
  } as unknown as jest.Mocked<LiteLLMConnectionService>;
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        'litellm.appBuilderApiKey': 'app-builder-key',
      };
      return values[key] ?? fallback;
    }),
  } as unknown as ConfigService;
  const request = Object.assign(new EventEmitter(), {
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('jest'),
  }) as unknown as Request;
  const user = { _id: { toString: () => 'user-123' } } as unknown as UserDocument;
  const usageService = {
    resolveTokens: jest.fn((usage?: { prompt_tokens?: number; completion_tokens?: number }) => {
      if (!usage || (usage.prompt_tokens === undefined && usage.completion_tokens === undefined)) {
        return { status: 'unknown' as const };
      }
      return {
        status: 'known' as const,
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
      };
    }),
    recordChatCompletionUsage: jest.fn().mockResolvedValue(undefined),
  } as unknown as AiProxyUsageService;
  const body: ChatCompletionDto = {
    model: 'gpt-4o',
    messages: [{ role: ChatMessageRole.USER, content: 'Hello' }],
    stream: true,
  };

  const createResponse = (): PassThrough & Partial<Response> => {
    const response = new PassThrough() as PassThrough & Partial<Response>;
    response.headersSent = false;
    response.setHeader = jest.fn();
    response.status = jest.fn().mockReturnValue(response);
    response.flushHeaders = jest.fn(() => {
      response.headersSent = true;
    });
    return response;
  };

  const createService = () =>
    new AiProxyStreamService(connectionService, configService, usageService);

  beforeEach(() => {
    jest.clearAllMocks();
    stream = new PassThrough();
    connectionService.getHttpClient.mockReturnValue({
      post,
    } as unknown as AxiosInstance);
    post.mockResolvedValue({ data: stream });
  });

  afterEach(() => {
    stream.removeAllListeners();
    stream.destroy();
  });

  it('forwards multiple SSE chunks and preserves the DONE marker', async () => {
    const response = createResponse();
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));

    await createService().streamChatCompletion(request, response as Response, body, user);

    stream.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
    stream.write('data: [DONE]\n\n');
    stream.end();
    await onceFinish(response);

    expect(Buffer.concat(chunks).toString()).toBe(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(post).toHaveBeenCalledWith(
      '/v1/chat/completions',
      expect.objectContaining({
        stream: true,
        stream_options: { include_usage: true },
      }),
      expect.objectContaining({
        responseType: 'stream',
        timeout: AI_PROXY_REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: 'Bearer app-builder-key',
          'X-Request-User': 'user-123',
        },
      }),
    );
  });

  it('records known streaming tokens from the final usage chunk', async () => {
    const response = createResponse();

    await createService().streamChatCompletion(request, response as Response, body, user);

    stream.write('data: {"id":"chatcmpl-s1","choices":[{"delta":{"content":"Hi"}}]}\n\n');
    stream.write(
      'data: {"id":"chatcmpl-s1","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
    );
    stream.write('data: [DONE]\n\n');
    stream.end();
    await onceFinish(response);
    await flushPromises();

    expect(usageService.recordChatCompletionUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        streaming: true,
        litellmRequestId: 'chatcmpl-s1',
        tokens: { status: 'known', promptTokens: 3, completionTokens: 2 },
      }),
    );
  });

  it('records unknown tokens when stream usage is missing', async () => {
    const response = createResponse();

    await createService().streamChatCompletion(request, response as Response, body, user);

    stream.end('data: {"choices":[]}\n\n');
    await onceFinish(response);
    await flushPromises();

    expect(usageService.recordChatCompletionUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        streaming: true,
        tokens: { status: 'unknown' },
      }),
    );
  });

  it('ends the client response when upstream omits DONE', async () => {
    const response = createResponse();

    await createService().streamChatCompletion(request, response as Response, body, user);

    stream.end('data: {"choices":[]}\n\n');
    await onceFinish(response);

    expect(response.writableEnded).toBe(true);
  });

  it('returns an upstream connection error before sending SSE headers', async () => {
    post.mockRejectedValueOnce(new AxiosError('connection refused', 'ECONNREFUSED'));
    const response = createResponse();

    await expect(
      createService().streamChatCompletion(request, response as Response, body, user),
    ).rejects.toThrow('LiteLLM');

    expect(response.headersSent).toBe(false);
  });

  it('destroys the upstream stream when the client disconnects', async () => {
    let resolveRequest: (value: { data: PassThrough }) => void = () => undefined;
    post.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const response = createResponse();
    const pending = createService()
      .streamChatCompletion(request, response as Response, body, user);

    request.emit('aborted');
    resolveRequest({ data: stream });
    await pending;

    expect(stream.destroyed).toBe(true);
  });
});

function onceFinish(stream: PassThrough): Promise<void> {
  return new Promise((resolve) => stream.once('finish', () => resolve()));
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

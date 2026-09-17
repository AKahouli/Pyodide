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
  const request = new EventEmitter() as Request;
  const user = { _id: { toString: () => 'user-123' } } as unknown as UserDocument;
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

    await new AiProxyStreamService(connectionService, configService)
      .streamChatCompletion(request, response as Response, body, user);

    stream.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\\n\\n');
    stream.write('data: [DONE]\\n\\n');
    stream.end();
    await onceFinish(response);

    expect(Buffer.concat(chunks).toString()).toBe(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\\n\\ndata: [DONE]\\n\\n',
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(response.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(response.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(post).toHaveBeenCalledWith(
      '/v1/chat/completions',
      { ...body, stream: true },
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

  it('ends the client response when upstream omits DONE', async () => {
    const response = createResponse();

    await new AiProxyStreamService(connectionService, configService)
      .streamChatCompletion(request, response as Response, body, user);

    stream.end('data: {"choices":[]}\\n\\n');
    await onceFinish(response);

    expect(response.writableEnded).toBe(true);
  });

  it('returns an upstream connection error before sending SSE headers', async () => {
    post.mockRejectedValueOnce(new AxiosError('connection refused', 'ECONNREFUSED'));
    const response = createResponse();

    await expect(
      new AiProxyStreamService(connectionService, configService)
        .streamChatCompletion(request, response as Response, body, user),
    ).rejects.toThrow('LiteLLM');

    expect(response.headersSent).toBe(false);
  });

  it('destroys the upstream stream when the client disconnects', async () => {
    let resolveRequest: (value: { data: PassThrough }) => void = () => undefined;
    post.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const response = createResponse();
    const pending = new AiProxyStreamService(connectionService, configService)
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

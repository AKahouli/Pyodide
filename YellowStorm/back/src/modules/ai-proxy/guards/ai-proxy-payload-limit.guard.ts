import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { BadRequestException } from '../../exceptions';
import { AI_PROXY_DEFAULT_MAX_BODY_BYTES } from '../constants/ai-proxy.constants';

/**
 * Rejects oversized AI-proxy POSTs using Content-Length when present.
 * Post-parse JSON size checks in AiProxyService still apply for chunked bodies.
 */
@Injectable()
export class AiProxyPayloadLimitGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method !== 'POST') {
      return true;
    }

    const maxBodyBytes = this.configService.get<number>(
      'aiProxy.maxBodyBytes',
      AI_PROXY_DEFAULT_MAX_BODY_BYTES,
    );
    const contentLengthHeader = request.headers['content-length'];
    if (contentLengthHeader == null) {
      return true;
    }

    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new BadRequestException('Invalid Content-Length header');
    }
    if (contentLength > maxBodyBytes) {
      throw new BadRequestException(
        `Request body is too large. Maximum allowed is ${maxBodyBytes} bytes.`,
      );
    }

    return true;
  }
}

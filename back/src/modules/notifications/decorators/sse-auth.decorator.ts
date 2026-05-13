import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { SseAuthGuard } from '../guards/sse-auth.guard';

export const SSE_AUTH_KEY = 'sseAuth';

/**
 * Decorator to enable SSE authentication via query parameter token
 * Use in combination with @Public() to skip the global JWT guard
 *
 * @example
 * @Public()
 * @SseAuth()
 * @Sse('stream')
 * stream(@Req() req): Observable<MessageEvent> {
 *   const userId = req.sseUser.sub;
 *   // ...
 * }
 */
export const SseAuth = () =>
  applyDecorators(SetMetadata(SSE_AUTH_KEY, true), UseGuards(SseAuthGuard));

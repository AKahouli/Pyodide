import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { SseAuthGuard } from '../guards/stream-auth.guard';

export const STREAM_AUTH_KEY = 'streamAuth';

export function StreamAuth() {
  return applyDecorators(
    SetMetadata(STREAM_AUTH_KEY, true),
    UseGuards(SseAuthGuard),
  );
}

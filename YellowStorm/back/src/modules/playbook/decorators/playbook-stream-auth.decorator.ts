import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { PlaybookStreamAuthGuard } from '../guards/playbook-stream-auth.guard';

export const PLAYBOOK_STREAM_AUTH_KEY = 'playbookStreamAuth';

export function PlaybookStreamAuth() {
  return applyDecorators(
    SetMetadata(PLAYBOOK_STREAM_AUTH_KEY, true),
    UseGuards(PlaybookStreamAuthGuard),
  );
}

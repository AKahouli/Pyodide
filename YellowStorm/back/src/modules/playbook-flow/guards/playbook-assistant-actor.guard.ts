import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

@Injectable()
export class PlaybookAssistantActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const headers = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>().headers;
    const required = [
      'x-yellowstorm-user-id',
      'x-yellowstorm-agent-id',
      'x-yellowstorm-conversation-id',
      'x-correlation-id',
    ];
    if (required.some((name) => typeof headers[name] !== 'string' || !headers[name]?.trim() || headers[name]!.length > 200)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid trusted Playbook assistant actor identity');
    }
    return true;
  }
}

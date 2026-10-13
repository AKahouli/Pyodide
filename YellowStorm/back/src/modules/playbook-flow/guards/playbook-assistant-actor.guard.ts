import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UnauthorizedException } from '@modules/exceptions';
import { UserService } from '@modules/user';
import { assertAccountApproved } from '@modules/user/utils/assert-account-accessible';

@Injectable()
export class PlaybookAssistantActorGuard implements CanActivate {
  constructor(private readonly users: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const headers = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>().headers;
    const userId = headers['x-yellowstorm-user-id'];
    const optional = ['x-yellowstorm-agent-id', 'x-yellowstorm-conversation-id', 'x-correlation-id'];
    if (typeof userId !== 'string' || !userId.trim() || userId.length > 200
      || optional.some((name) => headers[name] !== undefined && (typeof headers[name] !== 'string' || !headers[name]?.trim() || headers[name].length > 200))) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid trusted Playbook assistant actor identity');
    }
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND);
    assertAccountApproved(user);
    return true;
  }
}

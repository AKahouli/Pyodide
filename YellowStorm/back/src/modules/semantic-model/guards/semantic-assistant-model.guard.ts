import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SemanticModelAssistantService } from '../services/semantic-model-assistant.service';

type Headers = Record<string, string | string[] | undefined>;

/**
 * Lets the assistant surface name a model by its id or by its exact name ("Billing & Contract
 * Management"): a name is turned into the id of the one model with that name the person can see.
 *
 * Identity itself is established by the shared {@link DelegatedActorGuard} (ADR-0024), which pins
 * the verified user id onto the request before this guard runs.
 */
@Injectable()
export class SemanticAssistantModelGuard implements CanActivate {
  constructor(private readonly assistant: SemanticModelAssistantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Headers; params?: Record<string, string> }>();
    const reference = request.params?.modelId;
    if (reference) request.params!.modelId = await this.assistant.resolveModelId(String(request.headers['x-yellowstorm-user-id']), reference);
    return true;
  }
}

const header = (headers: Headers, name: string) => {
  const value = headers[name];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
};

/** The person, agent and conversation behind a call already authenticated by {@link DelegatedActorGuard}. */
export function assistantActorFrom(headers: Headers) {
  return {
    userId: String(headers['x-yellowstorm-user-id']),
    agentId: header(headers, 'x-yellowstorm-agent-id'),
    conversationId: header(headers, 'x-yellowstorm-conversation-id'),
  };
}

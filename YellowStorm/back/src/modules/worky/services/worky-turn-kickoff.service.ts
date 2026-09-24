import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerService } from '../../logger';
import { asAuthUser, type AuthUser } from '@common/auth/auth-user';
import { UserService } from '../../user/user.service';
import { requesterOpts } from '../worky-requester.util';
import { WorkyOrchestratorGrpcClientService } from './worky-orchestrator.grpc-client.service';
import { WorkyPlanningService } from './worky-planning.service';
import { WorkyStreamService } from './worky-stream.service';
import { WorkyTurnContextService } from './worky-turn-context.service';

interface WorkyTurnKickoffInput {
  streamId: string;
  userId: string;
  content: string;
  turnId?: string;
  requester?: AuthUser;
}

export interface PreparedWorkyTurn {
  streamId: string;
  userId: string;
  content: string;
  turnId: string;
  aiSessionId: string;
  agents: unknown[];
  connectors: unknown[];
  requester: ReturnType<typeof requesterOpts>;
}

@Injectable()
export class WorkyTurnKickoffService {
  constructor(
    private readonly streams: WorkyStreamService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
    private readonly planning: WorkyPlanningService,
    private readonly users: UserService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyTurnKickoffService.name);
  }

  async prepare(input: WorkyTurnKickoffInput): Promise<PreparedWorkyTurn> {
    const turnId = input.turnId ?? randomUUID();
    const context = await this.streams.ensureKickoffContext(input.streamId, input.userId);
    const [agents, connectors, user] = await Promise.all([
      this.turnContext.resolveWorkyAgentsStrict(context.ownerUserId),
      this.turnContext.resolveConnectorsStrict(context.ownerUserId),
      input.requester ? Promise.resolve(input.requester) : this.users.findById(input.userId),
    ]);
    return {
      streamId: input.streamId,
      userId: context.ownerUserId,
      content: input.content,
      turnId,
      aiSessionId: context.aiSessionId,
      agents,
      connectors,
      requester: user ? requesterOpts(asAuthUser(user)) : {},
    };
  }

  dispatch(turn: PreparedWorkyTurn): string {
    this.logger.log('[worky-orchestrator] RunTask kickoff', {
      streamId: turn.streamId,
      aiSid: turn.aiSessionId,
      agentCount: turn.agents.length,
      connectorCount: turn.connectors.length,
      contentLength: turn.content.length,
    });
    void this.orchestrator
      .runTask(turn.userId, turn.aiSessionId, turn.content, {
        agents: turn.agents,
        connectors: turn.connectors,
        turnId: turn.turnId,
        ...turn.requester,
      })
      .catch((error: Error) => {
        this.logger.error('[worky-orchestrator] RunTask kickoff failed', {
          streamId: turn.streamId,
          turnId: turn.turnId,
          error: error.message,
        });
        this.planning.failTurn(turn.userId, turn.streamId, turn.turnId);
      });
    return turn.turnId;
  }

  async kickoff(input: WorkyTurnKickoffInput): Promise<string> {
    return this.dispatch(await this.prepare(input));
  }
}

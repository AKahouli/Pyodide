import { Injectable, Logger } from '@nestjs/common';
import { WorkyPlanningService } from '../services/worky-planning.service';
import { WorkyStreamService } from '../services/worky-stream.service';
import { WorkyOrchestratorGrpcClientService } from '../services/worky-orchestrator.grpc-client.service';
import { WorkyTurnContextService } from '../services/worky-turn-context.service';

@Injectable()
export class VoiceToolService {
  private readonly logger = new Logger(VoiceToolService.name);

  constructor(
    private readonly planning: WorkyPlanningService,
    private readonly streamService: WorkyStreamService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
  ) {}

  async dispatchTask(
    userId: string,
    streamId: string,
    message: string,
  ): Promise<{ runId: string; sessionId: string; accepted: boolean }> {
    await this.planning.appendOwnerMessage(userId, streamId, { content: message });
    const ctx = await this.streamService.ensureKickoffContext(streamId, userId);
    const [agents, connectors] = await Promise.all([
      this.turnContext.resolveWorkyAgents(userId),
      this.turnContext.resolveConnectors(userId),
    ]);
    const res = await this.orchestrator.runTask(userId, ctx.aiSessionId, message, { agents, connectors });
    this.logger.log(`[voice] dispatched task run=${res.runId} session=${res.sessionId}`);
    return { runId: res.runId, sessionId: res.sessionId, accepted: res.accepted };
  }

  async queryStatus(userId: string, streamId: string): Promise<{ status: string; title: string; plan: unknown }> {
    const ctx = await this.streamService.ensureKickoffContext(streamId, userId);
    const s = await this.orchestrator.getSession(userId, ctx.aiSessionId);
    return { status: s.status, title: s.title, plan: s.plan };
  }
}

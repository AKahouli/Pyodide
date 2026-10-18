import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import type { AdkExecutionAuthority } from '@modules/connector/services/mcp-jwt.service';
import {
  AdkRootRuntimeServiceGuard, AdkPlaybookArtifactServiceGuard, assertUnambiguousSecurityHeaders,
} from './internal-service-principal.guard';

export interface AdkNativeRequest {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  nativeActor: AdkExecutionAuthority;
}

/** Shared native tools accept only a live private dispatch proof. MCP assertions
 * and caller-supplied actor/job selectors cannot stand in for that authority. */
@Injectable()
export class AdkNativeActorGuard implements CanActivate {
  constructor(private readonly config: ConfigService, private readonly modules: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdkNativeRequest>();
    assertUnambiguousSecurityHeaders(request);
    const token = request.headers['x-yellowstorm-execution-authority'];
    if (typeof token !== 'string' || !token) throw new UnauthorizedException('Missing native dispatch authority');
    const principal = request.headers['x-yellowstorm-service-principal'];
    const workspaceId = request.params?.workspaceId ?? request.body?.workspaceId;
    let claims: AdkExecutionAuthority;

    // Resolve owning authorizers lazily after bootstrap. Importing the entire
    // Playbook module into Workspace would recreate its documented DI cycle.
    if (principal === 'adk-root-runtime') {
      await new AdkRootRuntimeServiceGuard(this.config).canActivate(context);
      const { RootWorkService } = await import('@modules/conversation/root-work/root-work.service');
      const root = this.modules.get(RootWorkService, { strict: false });
      claims = await root.assertAssetAuthority(token);
      if (claims.purpose === 'root-work') {
        const { RootDelegateDefinitionService } = await import('@modules/conversation/root-work/root-delegate-definition.service');
        await this.modules.get(RootDelegateDefinitionService, { strict: false })
          .assertCurrentAuthorityRights(claims.executionId);
      }
      await root.assertAuthorityWorkspace(claims, workspaceId);
    } else if (principal === 'adk-playbook-artifact') {
      await new AdkPlaybookArtifactServiceGuard(this.config).canActivate(context);
      const { McpJwtService } = await import('@modules/connector/services/mcp-jwt.service');
      const { PlaybookFlowArtifactService } = await import('@modules/playbook-flow/services/playbook-flow-artifact.service');
      const signed = this.modules.get(McpJwtService, { strict: false })
        .verifyAdkExecutionAuthority(token, 'playbook-artifact');
      claims = await this.modules.get(PlaybookFlowArtifactService, { strict: false })
        .assertPublicationAuthority(token, signed.executionId);
      if (workspaceId !== undefined) {
        const { ExecutionRepository } = await import('@modules/playbook-flow/persistence/execution.repository');
        const execution = await this.modules.get(ExecutionRepository, { strict: false })
          .findOwned(claims.executionId, claims.sub, { withSnapshot: true });
        const snapshot = execution?.snapshot;
        const workspaces = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
          ? snapshot.workspaces : undefined;
        if (typeof workspaceId !== 'string' || !Array.isArray(workspaces) || !workspaces.includes(workspaceId)) {
          throw new UnauthorizedException('Foreign native execution workspace');
        }
      }
    } else {
      throw new UnauthorizedException('Invalid native calling principal');
    }

    for (const selector of [request.body?.userId, request.headers['x-yellowstorm-user-id']]) {
      if (selector !== undefined && selector !== claims.sub) throw new UnauthorizedException('Foreign native actor');
    }
    const conversationId = request.body?.conversation_id ?? request.body?.conversationId;
    if (conversationId !== undefined && conversationId !== claims.conversationId) {
      throw new UnauthorizedException('Foreign native conversation');
    }
    request.nativeActor = Object.freeze({ ...claims });
    return true;
  }
}

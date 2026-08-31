import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AppDataAppRow } from '@modules/postgres/schema/app-data.schema';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import type { AppDataPolicyOperation } from '../constants/app-data.types';
import { AppDataEndUserAuthService } from './app-data-end-user-auth.service';
import { AppDataEndUserGrantsService } from './app-data-end-user-grants.service';
import { AppDataPolicyService } from './app-data-policy.service';

export interface PublicCrudAccessContext {
  skipPolicyCheck: boolean;
  principal: 'anonymous' | 'public' | 'yellowmind_owner';
}

@Injectable()
export class AppDataPublicAccessService {
  constructor(
    private readonly endUserAuth: AppDataEndUserAuthService,
    private readonly grants: AppDataEndUserGrantsService,
    private readonly policies: AppDataPolicyService,
  ) {}

  requiresEndUserAuth(app: AppDataAppRow, environment: AppDataEnvironment): boolean {
    return (
      this.endUserAuth.isEndUserAuthEnabledForApp(app) &&
      environment === 'prod'
    );
  }

  async authorizeCrud(params: {
    app: AppDataAppRow;
    environment: AppDataEnvironment;
    operation: AppDataPolicyOperation;
    req: Request;
  }): Promise<PublicCrudAccessContext> {
    if (this.requiresEndUserAuth(params.app, params.environment)) {
      const user = await this.endUserAuth.resolveEndUserFromRequest(
        params.app,
        params.req.headers.authorization,
      );
      await this.grants.assertAllowed(params.app.id, user.id, params.operation);
      return { skipPolicyCheck: true, principal: 'public' };
    }

    const principal = this.policies.resolvePrincipal({
      anonymous: !params.req.headers.authorization,
      ownerUserId: params.app.ownerUserId,
      requestUserId: null,
    });
    return { skipPolicyCheck: false, principal };
  }
}

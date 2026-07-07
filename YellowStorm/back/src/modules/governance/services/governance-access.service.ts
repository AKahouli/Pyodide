import { Injectable } from '@nestjs/common';
import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceMembershipService } from './governance-membership.service';
import { GovernanceProgramService } from './governance-program.service';

@Injectable()
export class GovernanceAccessService {
  constructor(private readonly membershipService: GovernanceMembershipService, private readonly programService: GovernanceProgramService) {}

  async assertScopeAccess(userId: string, programId: string, scopeId: string): Promise<void> {
    const accessibleScopeIds = await this.getAccessibleScopeIds(userId, programId);
    if (accessibleScopeIds.includes('*') || accessibleScopeIds.includes(scopeId)) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  async getAccessibleScopeIds(userId: string, programId: string): Promise<string[]> {
    if (await this.isProgramOwner(userId, programId)) return ['*'];
    return this.membershipService.getAccessibleScopeIds(userId, programId);
  }

  async assertScopeSelection(userId: string, programId: string, scopeIds: string[]): Promise<void> {
    const accessibleScopeIds = await this.getAccessibleScopeIds(userId, programId);
    if (accessibleScopeIds.includes('*')) return;
    if (scopeIds.every((scopeId) => accessibleScopeIds.includes(scopeId))) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  async assertProgramWideAccess(userId: string, programId: string): Promise<void> {
    const accessibleScopeIds = await this.getAccessibleScopeIds(userId, programId);
    if (accessibleScopeIds.includes('*')) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  async assertScopeRole(userId: string, programId: string, scopeId: string, roles: Parameters<GovernanceMembershipService['hasScopeRole']>[3]): Promise<void> {
    if (await this.isProgramOwner(userId, programId)) return;
    if (await this.membershipService.hasScopeRole(userId, programId, scopeId, ['program_admin', ...roles])) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  private async isProgramOwner(userId: string, programId: string): Promise<boolean> {
    try {
      await this.programService.assertProgramOwner(userId, programId);
      return true;
    } catch (error) {
      void error;
      return false;
    }
  }
}

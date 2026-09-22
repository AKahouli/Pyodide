import { Inject, Injectable } from '@nestjs/common';
import { ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  BINDING_STORE,
  GOVERNANCE_DOCUMENT_STORE,
  MEMBERSHIP_STORE,
  PROGRAM_STORE,
  SCOPE_STORE,
  type BindingStore,
  type GovernanceDocumentStore,
  type GovernanceProgramRecord,
  type MembershipStore,
  type ProgramStore,
  type ScopeStore,
} from '../persistence';
import { CreateGovernanceProgramDto, UpdateGovernanceProgramDto } from '../dto';

export interface GovernanceProgramResponse {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  defaultLanguage: string;
  status: 'draft' | 'published' | 'archived';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GovernanceProgramService {
  constructor(
    @Inject(PROGRAM_STORE) private readonly programStore: ProgramStore,
    @Inject(SCOPE_STORE) private readonly scopeStore: ScopeStore,
    @Inject(GOVERNANCE_DOCUMENT_STORE) private readonly documentStore: GovernanceDocumentStore,
    @Inject(BINDING_STORE) private readonly bindingStore: BindingStore,
    @Inject(MEMBERSHIP_STORE) private readonly membershipStore: MembershipStore,
  ) {}

  async create(ownerUserId: string, dto: CreateGovernanceProgramDto): Promise<GovernanceProgramResponse> {
    const name = dto.name.trim();
    const existing = await this.programStore.findByOwnerAndName(ownerUserId, name);
    if (existing) throw new ConflictException(ErrorCode.GOVERNANCE_PROGRAM_NAME_EXISTS);

    const program = await this.programStore.insert({
      ...dto,
      name,
      ownerUserId,
      defaultLanguage: dto.defaultLanguage ?? 'fr',
      status: dto.status ?? 'draft',
      metadata: dto.metadata ?? {},
    });
    return this.toResponse(program);
  }

  async listForOwner(ownerUserId: string): Promise<GovernanceProgramResponse[]> {
    const memberships = await this.membershipStore.findActiveByUser(ownerUserId);
    const programIds = [...new Set(memberships.map((membership) => membership.programId))];
    const programs = await this.programStore.listForOwner(ownerUserId, programIds);
    return programs.map((program) => this.toResponse(program));
  }

  async findById(ownerUserId: string, programId: string): Promise<GovernanceProgramResponse> {
    const program = await this.findAccessibleProgram(ownerUserId, programId);
    return this.toResponse(program);
  }

  async update(ownerUserId: string, programId: string, dto: UpdateGovernanceProgramDto): Promise<GovernanceProgramResponse> {
    const program = await this.programStore.findByOwnerAndId(ownerUserId, programId);
    if (!program) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);

    let name: string | undefined;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      const duplicate = await this.programStore.findByOwnerAndName(ownerUserId, name);
      if (duplicate && duplicate.id !== program.id) throw new ConflictException(ErrorCode.GOVERNANCE_PROGRAM_NAME_EXISTS);
    }
    const updated = await this.programStore.update(program.id, {
      ...(name !== undefined ? { name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.domain !== undefined ? { domain: dto.domain } : {}),
      ...(dto.defaultLanguage !== undefined ? { defaultLanguage: dto.defaultLanguage } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.metadata !== undefined ? { metadata: dto.metadata } : {}),
    });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
    return this.toResponse(updated);
  }

  async delete(ownerUserId: string, programId: string): Promise<void> {
    const program = await this.programStore.findById(programId);
    if (!program) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
    const isOwner = program.ownerUserId === ownerUserId;
    const isProgramAdmin = await this.hasActiveProgramRole(ownerUserId, programId, 'program_admin');
    if (!isOwner && !isProgramAdmin) throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);

    const [scopeCount, documentCount, bindingCount] = await Promise.all([
      this.scopeStore.countByProgram(programId),
      this.documentStore.countByProgram(programId),
      this.bindingStore.countByProgram(programId),
    ]);
    if (scopeCount > 0 || documentCount > 0 || bindingCount > 0) {
      throw new ConflictException(ErrorCode.GOVERNANCE_PROGRAM_DELETE_BLOCKED);
    }
    await this.programStore.deleteById(programId);
  }

  private async hasActiveProgramRole(userId: string, programId: string, role: string): Promise<boolean> {
    const membership = (await this.membershipStore.findActiveForUser(programId, userId, [])).find(
      (candidate) => !candidate.scopeId && candidate.role === role,
    );
    return Boolean(membership);
  }

  async assertOwnedProgram(ownerUserId: string, programId: string): Promise<void> {
    await this.findAccessibleProgram(ownerUserId, programId);
  }

  async assertProgramOwner(ownerUserId: string, programId: string): Promise<void> {
    const program = await this.programStore.findByOwnerAndId(ownerUserId, programId);
    if (!program) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
  }

  private async findAccessibleProgram(ownerUserId: string, programId: string): Promise<GovernanceProgramRecord> {
    const program = await this.programStore.findByOwnerAndId(ownerUserId, programId);
    if (program) return program;
    const membership = await this.membershipStore.findActiveForUser(programId, ownerUserId, []);
    if (membership.length === 0) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
    const accessibleProgram = await this.programStore.findById(programId);
    if (!accessibleProgram) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
    return accessibleProgram;
  }

  private toResponse(doc: GovernanceProgramRecord): GovernanceProgramResponse {
    return {
      id: doc.id,
      name: doc.name,
      description: doc.description,
      domain: doc.domain,
      defaultLanguage: doc.defaultLanguage,
      status: doc.status,
      metadata: doc.metadata ?? {},
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt),
    };
  }
}

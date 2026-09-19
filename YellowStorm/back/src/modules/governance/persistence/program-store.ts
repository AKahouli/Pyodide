import type { GovernanceProgramRecord } from './governance-records';

export const PROGRAM_STORE = Symbol('GOVERNANCE_PROGRAM_STORE');

export type GovernanceProgramCreateInput = Pick<
  GovernanceProgramRecord,
  'name' | 'description' | 'domain' | 'defaultLanguage' | 'status' | 'ownerUserId' | 'metadata'
>;

export type GovernanceProgramPatch = Partial<
  Pick<GovernanceProgramRecord, 'name' | 'description' | 'domain' | 'defaultLanguage' | 'status' | 'metadata'>
>;

/** Internal write/read store for the governance_programs aggregate. */
export interface ProgramStore {
  insert(input: GovernanceProgramCreateInput): Promise<GovernanceProgramRecord>;
  findById(id: string): Promise<GovernanceProgramRecord | null>;
  findByOwnerAndName(ownerUserId: string, name: string): Promise<GovernanceProgramRecord | null>;
  /** Programs owned by the user or present in `memberProgramIds`, newest update first. */
  listForOwner(ownerUserId: string, memberProgramIds: string[]): Promise<GovernanceProgramRecord[]>;
  update(id: string, patch: GovernanceProgramPatch): Promise<GovernanceProgramRecord | null>;
  deleteById(id: string): Promise<void>;
  findByOwnerAndId(ownerUserId: string, programId: string): Promise<GovernanceProgramRecord | null>;
}

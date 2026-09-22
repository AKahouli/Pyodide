import { Inject, Injectable } from '@nestjs/common';
import {
  GOVERNANCE_EVENT_STORE,
  type AppendGovernanceDocumentEventInput,
  type GovernanceDocumentEventRecord,
  type GovernanceEventStore,
} from '../persistence';

@Injectable()
export class GovernanceDocumentEventService {
  constructor(@Inject(GOVERNANCE_EVENT_STORE) private readonly eventStore: GovernanceEventStore) {}

  async append(input: AppendGovernanceDocumentEventInput): Promise<GovernanceDocumentEventRecord> {
    return this.eventStore.append(input);
  }

  async findByDeduplicationKey(governanceDocumentId: string, key: string): Promise<GovernanceDocumentEventRecord | null> {
    return this.eventStore.findByDeduplicationKey(governanceDocumentId, key);
  }

  async list(governanceDocumentId: string): Promise<GovernanceDocumentEventRecord[]> {
    return this.eventStore.listByGovernanceDocument(governanceDocumentId);
  }
}

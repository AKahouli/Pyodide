import { Injectable } from '@nestjs/common';
import {
  type AppendGovernanceDocumentEventInput,  
  type GovernanceDocumentEventRecord,  
} from '../persistence';
import { PgGovernanceEventStore } from '../persistence/postgres/pg-document-event.store';

@Injectable()
export class GovernanceDocumentEventService {
  constructor(private readonly eventStore: PgGovernanceEventStore) {}

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

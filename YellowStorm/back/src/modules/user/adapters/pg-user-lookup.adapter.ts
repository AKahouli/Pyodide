import { Inject, Injectable } from '@nestjs/common';
import { UserLookupPort, type UserSummary } from '@common/ports/user-lookup.port';
import { USER_STORE, type UserStore } from '../persistence/user.store';

/** PostgreSQL UserLookupPort over USER_STORE (bound by the remediation plan, step 1). */
@Injectable()
export class PgUserLookupAdapter implements UserLookupPort {
  constructor(@Inject(USER_STORE) private readonly userStore: UserStore) {}

  private toSummary(record: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    status: string;
  }): UserSummary {
    return {
      id: record.id,
      email: record.email,
      firstName: record.firstName ?? '',
      lastName: record.lastName ?? '',
      status: record.status,
    };
  }

  async byId(id: string): Promise<UserSummary | null> {
    const record = await this.userStore.findById(id);
    return record ? this.toSummary(record) : null;
  }

  async byIds(ids: string[]): Promise<Map<string, UserSummary>> {
    const records = await this.userStore.findByIds(ids);
    return new Map([...records.values()].map((r) => [r.id, this.toSummary(r)]));
  }

  async byEmails(emails: string[]): Promise<Map<string, UserSummary>> {
    const records = await this.userStore.findByEmails(emails);
    return new Map([...records.values()].map((r) => [r.email.toLowerCase(), this.toSummary(r)]));
  }
}

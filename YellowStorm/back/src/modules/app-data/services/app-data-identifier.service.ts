import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { assertAppDataId } from '../utils/app-data-sql.util';

@Injectable()
export class AppDataIdentifierService {
  /** Generate a lowercase opaque appDataId (16 hex chars). */
  generate(): string {
    return randomBytes(8).toString('hex');
  }

  validate(appDataId: string): void {
    assertAppDataId(appDataId);
  }
}

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class AppDataIdentifierService {
  /** Generate a lowercase opaque appDataId (16 hex chars). */
  generate(): string {
    return randomBytes(8).toString('hex');
  }
}

import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

export interface IssuedRuntimeToken {
  token: string;
  hash: string;
}

/**
 * Mints and hashes MCP bearer tokens. Only the hash is persisted, so a leaked
 * database dump cannot be replayed against the Runtime MCP endpoint.
 */
@Injectable()
export class RuntimeTokenService {
  issue(): IssuedRuntimeToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

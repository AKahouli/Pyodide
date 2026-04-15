import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('app.encryptionKey')?.trim();
    if (encryptionKey) {
      this.key = Buffer.from(encryptionKey, 'hex');
      // Log first 8 chars of the key fingerprint so admin can verify the right key is loaded
      const fingerprint = crypto.createHash('sha256').update(this.key).digest('hex').slice(0, 8);
      console.log(`[CryptoService] Encryption key loaded (fingerprint: ${fingerprint})`);
    } else {
      // Deterministic dev key — survives restarts but NOT secure for production.
      // ENCRYPTION_KEY is required in production via config validation.
      this.key = crypto.createHash('sha256').update('yellostorm-dev-encryption-key').digest();
      console.warn('[CryptoService] No ENCRYPTION_KEY set — using deterministic dev key. Not safe for production.');
    }
  }

  /**
   * Encrypt a plaintext string using AES-256-GCM.
   * Returns a JSON string containing { iv, tag, data }.
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    const payload: EncryptedPayload = {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    };

    return JSON.stringify(payload);
  }

  /**
   * Decrypt a previously encrypted value.
   * Expects a JSON string containing { iv, tag, data }.
   */
  decrypt(encryptedJson: string): string {
    const payload: EncryptedPayload = JSON.parse(encryptedJson);
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Check if a value looks like an encrypted payload (JSON with iv/tag/data).
   */
  isEncrypted(value: string): boolean {
    try {
      const parsed = JSON.parse(value);
      return (
        typeof parsed === 'object' &&
        typeof parsed.iv === 'string' &&
        typeof parsed.tag === 'string' &&
        typeof parsed.data === 'string'
      );
    } catch {
      return false;
    }
  }
}

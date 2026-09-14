import * as crypto from 'crypto';

/**
 * Authenticated encryption for refresh-rotation receipts.
 *
 * The receipt stores the successor refresh secret (never the access JWT) so a
 * refresh whose response was lost after commit can be recovered within the
 * bounded receipt window. The key is provisioned per deployment via
 * AUTH_ROTATION_RECEIPT_KEY (base64, 32 bytes) and is distinct from the JWT
 * signing secret. No plaintext secret is ever stored or logged.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

export interface RotationReceiptAad {
  predecessorSessionId: string;
  successorSessionId: string;
  tokenFamily: string;
  rotationAttemptId: string;
  receiptExpiresAt: number; // epoch ms
}

export class RotationReceiptCrypto {
  private readonly key: Buffer | null;
  private readonly keyId: string;

  constructor(rawKey: string | undefined, keyId: string) {
    this.key = rawKey ? Buffer.from(rawKey, 'base64') : null;
    this.keyId = keyId;
    if (this.key && this.key.length !== 32) {
      // Joi validation guards this; fail loudly if constructed programmatically.
      throw new Error('Rotation receipt key must decode to exactly 32 bytes');
    }
  }

  /** Receipts are an opt-in capability gated on provisioned key material. */
  isAvailable(): boolean {
    return this.key !== null;
  }

  getKeyId(): string {
    return this.keyId;
  }

  seal(secret: string, aad: RotationReceiptAad): string {
    if (!this.key) {
      throw new Error('Rotation receipt key is not provisioned');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(aad), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      this.keyId,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Open a receipt. Returns the sealed secret only when the ciphertext is
   * intact AND the caller-supplied binding context matches the AAD exactly.
   */
  open(receipt: string, aad: RotationReceiptAad): string | null {
    if (!this.key) {
      throw new Error('Rotation receipt key is not provisioned');
    }
    const parts = receipt.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION) {
      return null;
    }
    const [, keyId, ivPart, tagPart, dataPart] = parts;
    if (keyId !== this.keyId) {
      return null;
    }
    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        this.key,
        Buffer.from(ivPart, 'base64url'),
      );
      decipher.setAAD(Buffer.from(JSON.stringify(aad), 'utf8'));
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(dataPart, 'base64url')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      // Wrong key, tampered ciphertext, or mismatched binding context.
      return null;
    }
  }
}

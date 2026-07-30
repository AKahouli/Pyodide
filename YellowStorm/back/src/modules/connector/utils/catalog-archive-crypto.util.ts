import * as crypto from 'crypto';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { CatalogArchiveV1, EncryptedCatalogArchive } from '../interfaces/catalog-transfer.interface';

const PASSPHRASE_MIN_LENGTH = 12;

export function encryptCatalogArchive(
  archive: CatalogArchiveV1,
  passphrase: string,
): EncryptedCatalogArchive {
  assertPassphrase(passphrase);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(archive), 'utf8'),
    cipher.final(),
  ]);

  return {
    format: 'yellowstorm-catalog-encrypted',
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptCatalogArchive(
  envelope: EncryptedCatalogArchive,
  passphrase: string,
): CatalogArchiveV1 {
  assertPassphrase(passphrase);
  try {
    if (
      envelope.format !== 'yellowstorm-catalog-encrypted'
      || envelope.version !== 1
      || envelope.algorithm !== 'aes-256-gcm'
      || envelope.kdf !== 'scrypt'
    ) {
      throw new Error('Unsupported envelope');
    }
    const key = crypto.scryptSync(passphrase, Buffer.from(envelope.salt, 'base64'), 32);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as CatalogArchiveV1;
  } catch {
    throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The archive passphrase is invalid or the archive was modified.');
  }
}

function assertPassphrase(passphrase: string): void {
  if (!passphrase || passphrase.length < PASSPHRASE_MIN_LENGTH) {
    throw new BadRequestException(
      ErrorCode.BAD_REQUEST,
      `The archive passphrase must contain at least ${PASSPHRASE_MIN_LENGTH} characters.`,
    );
  }
}

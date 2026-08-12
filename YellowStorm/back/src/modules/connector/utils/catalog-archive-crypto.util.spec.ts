import { CatalogArchiveV1 } from '../interfaces/catalog-transfer.interface';
import { decryptCatalogArchive, encryptCatalogArchive } from './catalog-archive-crypto.util';

const archive: CatalogArchiveV1 = {
  format: 'yellowstorm-catalog',
  version: 1,
  resource: 'connectors',
  exportedAt: '2026-07-29T00:00:00.000Z',
  securityIncluded: true,
  connectorCategories: [],
  skillCategories: [],
  skills: [],
  connectors: [],
  security: {
    connectorCredentials: [],
    connectedAppDefinitions: [],
    userAppConnections: [],
    adminConnectorAuth: [{
      appKey: 'github',
      accessToken: 'secret-token',
      refreshToken: '',
      tokenExpiresAt: null,
      scopes: [],
      providerAccountId: '',
      providerEmail: '',
      connected: true,
      status: 'active',
      disconnectedAt: null,
      lastUsedAt: null,
      lastRefreshedAt: null,
      errorMessage: '',
    }],
  },
};

describe('catalog archive crypto', () => {
  it('round-trips a protected archive without exposing plaintext secrets', () => {
    const encrypted = encryptCatalogArchive(archive, 'portable-passphrase');

    expect(JSON.stringify(encrypted)).not.toContain('secret-token');
    expect(decryptCatalogArchive(encrypted, 'portable-passphrase')).toEqual(archive);
  });

  it('rejects an incorrect passphrase', () => {
    const encrypted = encryptCatalogArchive(archive, 'portable-passphrase');

    expect(() => decryptCatalogArchive(encrypted, 'different-passphrase')).toThrow(
      'The archive passphrase is invalid or the archive was modified.',
    );
  });

  it('rejects modified ciphertext', () => {
    const encrypted = encryptCatalogArchive(archive, 'portable-passphrase');
    encrypted.data = `${encrypted.data.slice(0, -4)}AAAA`;

    expect(() => decryptCatalogArchive(encrypted, 'portable-passphrase')).toThrow();
  });
});

import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@common/services/crypto.service';
import {
  ConnectorAuthServiceImpl, ENCRYPTED_CONNECTOR_HEADERS, PORTABLE_CONNECTOR_HEADERS,
  openConnectorHeaders, sealConnectorHeaders,
} from './connector-auth.service';

describe('Connector server headers with real AES-GCM', () => {
  const connectorId = '507f1f77bcf86cd799439011';
  const destination = 'https://mcp.example.test/mcp';
  const canary = 'TEST_CANARY_R03_ENCRYPTED_HEADER';
  const headers = { 'X-Api-Key': canary };
  const config = new ConfigService({ app: { encryptionKey: 'a1'.repeat(32) } });
  let crypto: CryptoService;
  beforeAll(() => { crypto = new CryptoService(config); });

  it('stores only ciphertext and authenticates the connector and destination on open', () => {
    const sealed = sealConnectorHeaders(crypto, config, connectorId, destination, headers);
    expect(JSON.stringify(sealed)).not.toContain(canary);
    expect(openConnectorHeaders(crypto, config, connectorId, sealed)).toEqual({ headers, migration: undefined });
    expect(() => openConnectorHeaders(crypto, config, 'foreign-connector', sealed)).toThrow();
    expect(() => openConnectorHeaders(crypto, config, connectorId,
      { ...sealed, destination: 'https://foreign.example.test/mcp' })).toThrow();
    expect(sealConnectorHeaders(crypto, config, connectorId, destination, headers).encryptedHeaders)
      .not.toEqual(sealed.encryptedHeaders);
  });

  it('rejects ciphertext modification and the wrong deployment key', () => {
    const sealed = sealConnectorHeaders(crypto, config, connectorId, destination, headers);
    const encrypted = JSON.parse(sealed.encryptedHeaders as string) as { data: string; iv: string; tag: string };
    encrypted.data = (encrypted.data[0] === '0' ? '1' : '0') + encrypted.data.slice(1);
    expect(() => openConnectorHeaders(crypto, config, connectorId,
      { ...sealed, encryptedHeaders: JSON.stringify(encrypted) })).toThrow();
    const foreignConfig = new ConfigService({ app: { encryptionKey: 'b2'.repeat(32) } });
    expect(() => openConnectorHeaders(new CryptoService(foreignConfig), foreignConfig, connectorId, sealed)).toThrow();
  });

  it('does not use the legacy development-key fallback for this credential store', () => {
    const missing = new ConfigService({});
    const legacy = new CryptoService(missing);
    expect(() => sealConnectorHeaders(legacy, missing, connectorId, destination, headers)).toThrow();
    const sealed = sealConnectorHeaders(crypto, config, connectorId, destination, headers);
    expect(() => openConnectorHeaders(crypto, missing, connectorId, sealed)).toThrow();
    expect(() => openConnectorHeaders(undefined, config, connectorId, sealed)).toThrow();
  });

  const unsafeHeaders: Record<string, string>[] = [
    { 'X-YellowStorm-Service-Token': canary },
    { 'X-Internal-Token': canary },
    { 'X-User-Id': canary },
    { 'X-Api-Key': canary, 'x-api-key': canary },
    { 'X-Api-Key': `${canary}\r\nInjected: header` },
  ];
  it.each(unsafeHeaders)('rejects ambiguous, reserved or injectable headers before encryption: %j', unsafe => {
    expect(() => sealConnectorHeaders(crypto, config, connectorId, destination, unsafe)).toThrow();
  });

  it('resolves decrypted server auth without provider or per-user credential substitution', async () => {
    const connected = { getValidToken: jest.fn() };
    const credentials = { findActiveByConnectorId: jest.fn() };
    const service = new ConnectorAuthServiceImpl(connected as never, credentials as never, {} as never,
      { setContext: jest.fn(), warn: jest.fn() } as never, config, crypto);
    const runtimeAuthConfig = sealConnectorHeaders(crypto, config, connectorId, destination, headers);
    await expect(service.resolveRuntimeAuth('actor', { connectorId, authSourceType: 'server_config',
      connectedAppKey: '', runtimeAuthConfig })).resolves.toEqual({ headers, env: {} });
    await expect(service.resolveRuntimeAuth('actor', { connectorId, authSourceType: 'connected_app',
      connectedAppKey: 'microsoft', runtimeAuthConfig })).rejects.toThrow();
    expect(connected.getValidToken).not.toHaveBeenCalled();
    expect(credentials.findActiveByConnectorId).not.toHaveBeenCalled();
  });

  it.each([PORTABLE_CONNECTOR_HEADERS, 'custom_headers'])('never falls back from invalid protected runtime configuration: %s', strategy => {
    const connected = { getValidToken: jest.fn() };
    const service = new ConnectorAuthServiceImpl(connected as never, {} as never, {} as never,
      { setContext: jest.fn(), warn: jest.fn() } as never, config, crypto);
    return expect(service.resolveRuntimeAuth('actor', { connectorId, authSourceType: 'connected_app',
      connectedAppKey: 'microsoft', runtimeAuthConfig: { strategy, encryptedHeaders: 'corrupt',
        headerMappings: { Authorization: canary } } })).rejects.toThrow();
  });

  it('returns a neutral error without serialized credentials or encrypted payloads', () => {
    const runtime = { strategy: ENCRYPTED_CONNECTOR_HEADERS, destination, encryptedHeaders: canary };
    try {
      openConnectorHeaders(crypto, config, connectorId, runtime);
      throw new Error('Expected authentication failure');
    } catch (error) {
      expect(String(error)).toContain('Encrypted connector authentication is unavailable or invalid');
      expect(String(error)).not.toContain(canary);
    }
  });
});

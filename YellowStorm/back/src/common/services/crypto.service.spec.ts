import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  const TEST_ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'app.encryptionKey') return TEST_ENCRYPTION_KEY;
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  describe('encrypt/decrypt roundtrip', () => {
    it('should encrypt and decrypt a simple string', () => {
      const plaintext = 'my-secret-client-id';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });

    it('should encrypt and decrypt an empty string', () => {
      const encrypted = service.encrypt('');
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe('');
    });

    it('should encrypt and decrypt unicode content', () => {
      const plaintext = 'clé-secrète-avec-des-accents-éàü-🔑';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt a long string', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for the same plaintext (unique IV)', () => {
      const plaintext = 'same-value';
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      // Both should decrypt to the same value
      expect(service.decrypt(encrypted1)).toBe(plaintext);
      expect(service.decrypt(encrypted2)).toBe(plaintext);
    });
  });

  describe('encrypted payload format', () => {
    it('should produce valid JSON with iv, tag, and data fields', () => {
      const encrypted = service.encrypt('test');
      const parsed = JSON.parse(encrypted);

      expect(parsed).toHaveProperty('iv');
      expect(parsed).toHaveProperty('tag');
      expect(parsed).toHaveProperty('data');
      expect(typeof parsed.iv).toBe('string');
      expect(typeof parsed.tag).toBe('string');
      expect(typeof parsed.data).toBe('string');
    });

    it('should use hex encoding for all fields', () => {
      const encrypted = service.encrypt('test');
      const parsed = JSON.parse(encrypted);

      // All fields should be valid hex strings
      expect(parsed.iv).toMatch(/^[0-9a-f]+$/);
      expect(parsed.tag).toMatch(/^[0-9a-f]+$/);
      expect(parsed.data).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('tamper detection', () => {
    it('should throw when ciphertext is tampered with', () => {
      const encrypted = service.encrypt('secret');
      const parsed = JSON.parse(encrypted);

      // Tamper with the data
      parsed.data = 'ff' + parsed.data.slice(2);
      const tampered = JSON.stringify(parsed);

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should throw when auth tag is tampered with', () => {
      const encrypted = service.encrypt('secret');
      const parsed = JSON.parse(encrypted);

      // Tamper with the tag
      parsed.tag = 'ff' + parsed.tag.slice(2);
      const tampered = JSON.stringify(parsed);

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should throw when IV is tampered with', () => {
      const encrypted = service.encrypt('secret');
      const parsed = JSON.parse(encrypted);

      // Tamper with the IV
      parsed.iv = 'ff' + parsed.iv.slice(2);
      const tampered = JSON.stringify(parsed);

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should throw on invalid JSON input', () => {
      expect(() => service.decrypt('not-json')).toThrow();
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted values', () => {
      const encrypted = service.encrypt('test');
      expect(service.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(service.isEncrypted('plain-text')).toBe(false);
    });

    it('should return false for invalid JSON', () => {
      expect(service.isEncrypted('{')).toBe(false);
    });

    it('should return false for JSON without required fields', () => {
      expect(service.isEncrypted(JSON.stringify({ foo: 'bar' }))).toBe(false);
    });

    it('should return false for JSON with non-string fields', () => {
      expect(service.isEncrypted(JSON.stringify({ iv: 123, tag: 'a', data: 'b' }))).toBe(false);
    });
  });

  describe('deterministic dev key', () => {
    it('should use deterministic key when ENCRYPTION_KEY is not set', async () => {
      const devConfigService = {
        get: jest.fn(() => ''),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          { provide: ConfigService, useValue: devConfigService },
        ],
      }).compile();

      const devService = module.get<CryptoService>(CryptoService);

      // Should work — encrypt and decrypt
      const encrypted = devService.encrypt('dev-secret');
      const decrypted = devService.decrypt(encrypted);
      expect(decrypted).toBe('dev-secret');
    });

    it('should produce same results across instances with no key (deterministic)', async () => {
      const devConfigService = { get: jest.fn(() => '') };

      const module1 = await Test.createTestingModule({
        providers: [
          CryptoService,
          { provide: ConfigService, useValue: devConfigService },
        ],
      }).compile();

      const module2 = await Test.createTestingModule({
        providers: [
          CryptoService,
          { provide: ConfigService, useValue: devConfigService },
        ],
      }).compile();

      const service1 = module1.get<CryptoService>(CryptoService);
      const service2 = module2.get<CryptoService>(CryptoService);

      const encrypted = service1.encrypt('cross-instance');
      const decrypted = service2.decrypt(encrypted);
      expect(decrypted).toBe('cross-instance');
    });
  });

  describe('key mismatch', () => {
    it('should fail to decrypt with a different key', async () => {
      const otherConfigService = {
        get: jest.fn(() => 'b'.repeat(64)),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          { provide: ConfigService, useValue: otherConfigService },
        ],
      }).compile();

      const otherService = module.get<CryptoService>(CryptoService);

      const encrypted = service.encrypt('secret');
      expect(() => otherService.decrypt(encrypted)).toThrow();
    });
  });
});

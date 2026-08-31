import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DocumentController } from './document.controller';
import { DownloadUrlRequestDto } from './dto/download-url.dto';

describe('DocumentController', () => {
  const SIGNED_URL = 'https://ceph.example/bucket/path/to/file.pdf?sig=abc';

  function createController(overrides: { defaultExpiry?: number } = {}) {
    const documentService = {
      generateSasUrl: jest.fn().mockResolvedValue(SIGNED_URL),
    };
    const configService = {
      get: jest.fn().mockReturnValue(overrides.defaultExpiry ?? 60),
    };
    const controller = new DocumentController(
      documentService as never,
      configService as never,
    );
    return { controller, documentService, configService };
  }

  describe('getDownloadUrl', () => {
    it('returns a signed url with the file path and effective expiry', async () => {
      const { controller } = createController();

      const result = await controller.getDownloadUrl({ filePath: 'path/to/file.pdf' });

      expect(result).toEqual({
        url: SIGNED_URL,
        filePath: 'path/to/file.pdf',
        expiresInMinutes: 60,
      });
    });

    it('presigns the requested path while verifying existence and allowing extensionless keys', async () => {
      const { controller, documentService } = createController();

      await controller.getDownloadUrl({ filePath: 'folder/Dockerfile' });

      expect(documentService.generateSasUrl).toHaveBeenCalledWith('folder/Dockerfile', {
        checkExists: true,
        allowExtensionless: true,
        expiryMinutes: undefined,
      });
    });

    it('passes a custom expiry through to the service and echoes it back', async () => {
      const { controller, documentService } = createController();

      const result = await controller.getDownloadUrl({
        filePath: 'path/to/file.pdf',
        expiryMinutes: 120,
      });

      expect(documentService.generateSasUrl).toHaveBeenCalledWith(
        'path/to/file.pdf',
        expect.objectContaining({ expiryMinutes: 120 }),
      );
      expect(result.expiresInMinutes).toBe(120);
    });

    it('propagates the service error when the file does not exist', async () => {
      const { controller, documentService } = createController();
      const notFound = new Error('Document file not found in storage');
      documentService.generateSasUrl.mockRejectedValue(notFound);

      await expect(
        controller.getDownloadUrl({ filePath: 'missing/file.pdf' }),
      ).rejects.toBe(notFound);
    });
  });

  describe('DownloadUrlRequestDto validation', () => {
    async function validateDto(payload: Record<string, unknown>) {
      const dto = plainToInstance(DownloadUrlRequestDto, payload);
      return validate(dto);
    }

    it('accepts a non-empty file path with no expiry', async () => {
      expect(await validateDto({ filePath: 'a/b/file.pdf' })).toHaveLength(0);
    });

    it('rejects an empty file path', async () => {
      const errors = await validateDto({ filePath: '' });
      expect(errors.some((e) => e.property === 'filePath')).toBe(true);
    });

    it('rejects a missing file path', async () => {
      const errors = await validateDto({});
      expect(errors.some((e) => e.property === 'filePath')).toBe(true);
    });

    it('rejects an expiry below the minimum', async () => {
      const errors = await validateDto({ filePath: 'a.pdf', expiryMinutes: 0 });
      expect(errors.some((e) => e.property === 'expiryMinutes')).toBe(true);
    });

    it('rejects an expiry above the 24h cap', async () => {
      const errors = await validateDto({ filePath: 'a.pdf', expiryMinutes: 1441 });
      expect(errors.some((e) => e.property === 'expiryMinutes')).toBe(true);
    });

    it('accepts an expiry within range', async () => {
      const errors = await validateDto({ filePath: 'a.pdf', expiryMinutes: 1440 });
      expect(errors).toHaveLength(0);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { DocumentService } from './document.service';
import { DocumentConnectionService, StorageConnectionStatus } from './document-connection.service';
import { LoggerService } from '../logger';
import { BadRequestException, InternalServerException, NotFoundException } from '../exceptions';

// Mock Azure Storage SAS generation
jest.mock('@azure/storage-blob', () => ({
  ...jest.requireActual('@azure/storage-blob'),
  generateBlobSASQueryParameters: jest.fn().mockReturnValue({
    toString: () => 'sv=2021-06-08&sig=mockSignature',
  }),
  BlobSASPermissions: {
    parse: jest.fn().mockReturnValue({}),
  },
}));

// Mock Azure Storage types
const mockBlockBlobClient = {
  url: 'https://storage.blob.core.windows.net/container/test-blob',
  upload: jest.fn(),
  download: jest.fn(),
  exists: jest.fn(),
  deleteIfExists: jest.fn(),
  getProperties: jest.fn(),
  beginCopyFromURL: jest.fn(),
};

const mockContainerClient = {
  getBlockBlobClient: jest.fn().mockReturnValue(mockBlockBlobClient),
  listBlobsFlat: jest.fn(),
};

const mockSharedKeyCredential = {
  accountName: 'testaccount',
};

describe('DocumentService', () => {
  let service: DocumentService;
  let connectionService: jest.Mocked<DocumentConnectionService>;
  let configService: jest.Mocked<ConfigService>;
  let loggerService: jest.Mocked<LoggerService>;

  const defaultConfig: Record<string, unknown> = {
    'storage.azure.containerName': 'documents',
    'storage.maxFileSizeMb': 50,
    'storage.maxFilesPerUpload': 10,
    'storage.sasExpiryMinutes': 60,
    'storage.allowedMimeTypes': ['application/pdf', 'image/png', 'text/plain'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        return defaultConfig[key] ?? defaultValue;
      }),
    };

    const mockLoggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockConnectionService = {
      isConnectedNow: jest.fn().mockReturnValue(true),
      getHealthStatus: jest.fn().mockReturnValue({
        available: true,
        connected: true,
        error: null,
        reconnectAttempts: 0,
        isReconnecting: false,
      } as StorageConnectionStatus),
      getContainerClient: jest.fn().mockReturnValue(mockContainerClient),
      getSharedKeyCredential: jest.fn().mockReturnValue(mockSharedKeyCredential),
      getContainerName: jest.fn().mockReturnValue('documents'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: DocumentConnectionService, useValue: mockConnectionService },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    connectionService = module.get(DocumentConnectionService);
    configService = module.get(ConfigService);
    loggerService = module.get(LoggerService);
  });

  describe('constructor', () => {
    it('should set logger context', () => {
      expect(loggerService.setContext).toHaveBeenCalledWith('DocumentService');
    });
  });

  describe('isAvailable', () => {
    it('should return true when connection service is connected', () => {
      connectionService.isConnectedNow.mockReturnValue(true);
      expect(service.isAvailable()).toBe(true);
    });

    it('should return false when connection service is not connected', () => {
      connectionService.isConnectedNow.mockReturnValue(false);
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status from connection service', () => {
      const expectedStatus: StorageConnectionStatus = {
        available: true,
        connected: true,
        error: null,
        reconnectAttempts: 0,
        isReconnecting: false,
      };
      connectionService.getHealthStatus.mockReturnValue(expectedStatus);

      const result = service.getHealthStatus();

      expect(result).toEqual(expectedStatus);
      expect(connectionService.getHealthStatus).toHaveBeenCalled();
    });
  });

  describe('upload', () => {
    const testFile = Buffer.from('test file content');
    const testFileName = 'test-file.pdf';
    const testMimeType = 'application/pdf';

    beforeEach(() => {
      mockBlockBlobClient.upload.mockResolvedValue({});
    });

    it('should upload a buffer successfully', async () => {
      const result = await service.upload(testFile, testFileName, testMimeType);

      expect(result).toMatchObject({
        originalName: testFileName,
        mimeType: testMimeType,
        size: testFile.length,
      });
      expect(result.id).toBeDefined();
      expect(result.contentHash).toBeDefined();
      expect(result.blobPath).toContain('test-file.pdf');
      expect(mockBlockBlobClient.upload).toHaveBeenCalled();
    });

    it('should upload a stream successfully', async () => {
      const stream = Readable.from([testFile]);

      const result = await service.upload(stream, testFileName, testMimeType);

      expect(result).toMatchObject({
        originalName: testFileName,
        mimeType: testMimeType,
      });
      expect(mockBlockBlobClient.upload).toHaveBeenCalled();
    });

    it('should use folder option when provided', async () => {
      const options = { folder: 'users/123/documents' };

      const result = await service.upload(testFile, testFileName, testMimeType, options);

      expect(result.blobPath).toContain('users/123/documents/');
    });

    it('should use custom file name when provided', async () => {
      const options = { customFileName: 'custom-name.pdf', generateUniqueName: false };

      const result = await service.upload(testFile, testFileName, testMimeType, options);

      expect(result.storedName).toBe('custom-name.pdf');
    });

    it('should not generate unique name when disabled', async () => {
      const options = { generateUniqueName: false };

      const result = await service.upload(testFile, testFileName, testMimeType, options);

      expect(result.storedName).toBe('test-file.pdf');
    });

    it('should include custom metadata', async () => {
      const options = { metadata: { userId: '123', category: 'reports' } };

      await service.upload(testFile, testFileName, testMimeType, options);

      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          metadata: expect.objectContaining({
            userId: '123',
            category: 'reports',
          }),
        }),
      );
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.upload(testFile, testFileName, testMimeType)).rejects.toThrow(
        InternalServerException,
      );
    });

    it('should throw BadRequestException for invalid MIME type', async () => {
      await expect(
        service.upload(testFile, testFileName, 'application/exe'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for file exceeding size limit', async () => {
      const largeFile = Buffer.alloc(60 * 1024 * 1024); // 60MB

      await expect(service.upload(largeFile, testFileName, testMimeType)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for empty file name', async () => {
      await expect(service.upload(testFile, '', testMimeType)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for file name exceeding 255 characters', async () => {
      const longFileName = 'a'.repeat(256) + '.pdf';

      await expect(service.upload(testFile, longFileName, testMimeType)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw InternalServerException when upload fails', async () => {
      mockBlockBlobClient.upload.mockRejectedValue(new Error('Upload failed'));

      await expect(service.upload(testFile, testFileName, testMimeType)).rejects.toThrow(
        InternalServerException,
      );
    });

    it('should validate stream file size after reading', async () => {
      const largeBuffer = Buffer.alloc(60 * 1024 * 1024);
      const stream = Readable.from([largeBuffer]);

      await expect(service.upload(stream, testFileName, testMimeType)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should sanitize file names with special characters', async () => {
      const result = await service.upload(testFile, '../path/to/file.pdf', testMimeType);

      expect(result.storedName).not.toContain('/');
      expect(result.storedName).not.toContain('\\');
    });
  });

  describe('uploadMany', () => {
    const testFiles = [
      { buffer: Buffer.from('file1'), originalName: 'file1.pdf', mimeType: 'application/pdf' },
      { buffer: Buffer.from('file2'), originalName: 'file2.png', mimeType: 'image/png' },
    ];

    beforeEach(() => {
      mockBlockBlobClient.upload.mockResolvedValue({});
    });

    it('should upload multiple files successfully', async () => {
      const results = await service.uploadMany(testFiles);

      expect(results).toHaveLength(2);
      expect(results[0].originalName).toBe('file1.pdf');
      expect(results[1].originalName).toBe('file2.png');
    });

    it('should throw BadRequestException when exceeding max files limit', async () => {
      const manyFiles = Array(11)
        .fill(null)
        .map((_, i) => ({
          buffer: Buffer.from(`file${i}`),
          originalName: `file${i}.pdf`,
          mimeType: 'application/pdf',
        }));

      await expect(service.uploadMany(manyFiles)).rejects.toThrow(BadRequestException);
    });

    it('should apply options to all files', async () => {
      const options = { folder: 'batch-uploads' };

      const results = await service.uploadMany(testFiles, options);

      results.forEach((result) => {
        expect(result.blobPath).toContain('batch-uploads/');
      });
    });
  });

  describe('download', () => {
    const testBlobPath = 'folder/test-file.pdf';
    const testContent = Buffer.from('file content');

    beforeEach(() => {
      mockBlockBlobClient.exists.mockResolvedValue(true);
      mockBlockBlobClient.download.mockResolvedValue({
        readableStreamBody: Readable.from([testContent]),
      });
    });

    it('should download a file successfully', async () => {
      const result = await service.download(testBlobPath);

      expect(result).toBeInstanceOf(Buffer);
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(testBlobPath);
    });

    it('should throw BadRequestException when file does not exist', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(false);

      await expect(service.download(testBlobPath)).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.download(testBlobPath)).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when download fails', async () => {
      mockBlockBlobClient.download.mockRejectedValue(new Error('Download failed'));

      await expect(service.download(testBlobPath)).rejects.toThrow(InternalServerException);
    });
  });

  describe('delete', () => {
    const testBlobPath = 'folder/test-file.pdf';

    beforeEach(() => {
      mockBlockBlobClient.deleteIfExists.mockResolvedValue({});
    });

    it('should delete a file successfully', async () => {
      await service.delete(testBlobPath);

      expect(mockBlockBlobClient.deleteIfExists).toHaveBeenCalledWith({
        deleteSnapshots: 'include',
      });
      expect(loggerService.log).toHaveBeenCalledWith('Document deleted', { blobPath: testBlobPath });
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.delete(testBlobPath)).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when delete fails', async () => {
      mockBlockBlobClient.deleteIfExists.mockRejectedValue(new Error('Delete failed'));

      await expect(service.delete(testBlobPath)).rejects.toThrow(InternalServerException);
    });
  });

  describe('deleteMany', () => {
    const testBlobPaths = ['file1.pdf', 'file2.pdf', 'file3.pdf'];

    beforeEach(() => {
      mockBlockBlobClient.deleteIfExists.mockResolvedValue({});
    });

    it('should delete multiple files successfully', async () => {
      await service.deleteMany(testBlobPaths);

      expect(mockBlockBlobClient.deleteIfExists).toHaveBeenCalledTimes(3);
    });
  });

  describe('exists', () => {
    const testBlobPath = 'folder/test-file.pdf';

    it('should return true when file exists', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);

      const result = await service.exists(testBlobPath);

      expect(result).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(false);

      const result = await service.exists(testBlobPath);

      expect(result).toBe(false);
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.exists(testBlobPath)).rejects.toThrow(InternalServerException);
    });
  });

  describe('generateSasUrl', () => {
    const testBlobPath = 'folder/test-file.pdf';

    it('should generate SAS URL successfully', async () => {
      const result = await service.generateSasUrl(testBlobPath);

      expect(result).toContain(mockBlockBlobClient.url);
      expect(result).toContain('?');
    });

    it('should use custom expiry minutes', async () => {
      const result = await service.generateSasUrl(testBlobPath, { expiryMinutes: 30 });

      expect(result).toBeDefined();
    });

    it('should use custom permissions', async () => {
      const result = await service.generateSasUrl(testBlobPath, { permissions: 'rw' });

      expect(result).toBeDefined();
    });

    it('should include content disposition', async () => {
      const result = await service.generateSasUrl(testBlobPath, {
        contentDisposition: 'attachment; filename="test.pdf"',
      });

      expect(result).toBeDefined();
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.generateSasUrl(testBlobPath)).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when shared key credential is not available', async () => {
      connectionService.getSharedKeyCredential.mockReturnValue(null);

      await expect(service.generateSasUrl(testBlobPath)).rejects.toThrow(InternalServerException);
    });

    it('should check blob existence when checkExists is true', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);

      const result = await service.generateSasUrl(testBlobPath, { checkExists: true });

      expect(result).toBeDefined();
      expect(mockBlockBlobClient.exists).toHaveBeenCalled();
    });

    it('should throw NotFoundException when checkExists is true and blob does not exist', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(false);

      await expect(
        service.generateSasUrl(testBlobPath, { checkExists: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    const mockBlobItems = [
      {
        name: 'folder/file1.pdf',
        properties: {
          contentLength: 1024,
          contentType: 'application/pdf',
          lastModified: new Date('2024-01-01'),
        },
        metadata: { userId: '123' },
      },
      {
        name: 'folder/file2.png',
        properties: {
          contentLength: 2048,
          contentType: 'image/png',
          lastModified: new Date('2024-01-02'),
        },
      },
    ];

    beforeEach(() => {
      const mockIterator = {
        next: jest.fn().mockResolvedValue({
          done: false,
          value: {
            segment: { blobItems: mockBlobItems },
            continuationToken: 'next-token',
          },
        }),
      };

      mockContainerClient.listBlobsFlat.mockReturnValue({
        byPage: jest.fn().mockReturnValue(mockIterator),
      });
    });

    it('should list documents successfully', async () => {
      const result = await service.list();

      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].name).toBe('file1.pdf');
      expect(result.documents[0].size).toBe(1024);
      expect(result.continuationToken).toBe('next-token');
    });

    it('should filter by folder prefix', async () => {
      await service.list({ folder: 'folder/' });

      expect(mockContainerClient.listBlobsFlat).toHaveBeenCalledWith({
        prefix: 'folder/',
      });
    });

    it('should use max results option', async () => {
      await service.list({ maxResults: 50 });

      expect(mockContainerClient.listBlobsFlat().byPage).toHaveBeenCalledWith(
        expect.objectContaining({ maxPageSize: 50 }),
      );
    });

    it('should use continuation token', async () => {
      await service.list({ continuationToken: 'prev-token' });

      expect(mockContainerClient.listBlobsFlat().byPage).toHaveBeenCalledWith(
        expect.objectContaining({ continuationToken: 'prev-token' }),
      );
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.list()).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when list fails', async () => {
      mockContainerClient.listBlobsFlat.mockReturnValue({
        byPage: jest.fn().mockReturnValue({
          next: jest.fn().mockRejectedValue(new Error('List failed')),
        }),
      });

      await expect(service.list()).rejects.toThrow(InternalServerException);
    });

    it('should handle empty result', async () => {
      mockContainerClient.listBlobsFlat.mockReturnValue({
        byPage: jest.fn().mockReturnValue({
          next: jest.fn().mockResolvedValue({
            done: true,
            value: undefined,
          }),
        }),
      });

      const result = await service.list();

      expect(result.documents).toHaveLength(0);
    });
  });

  describe('getMetadata', () => {
    const testBlobPath = 'folder/test-file.pdf';
    const mockProperties = {
      contentLength: 1024,
      contentType: 'application/pdf',
      lastModified: new Date('2024-01-01'),
      metadata: { userId: '123' },
    };

    it('should get metadata successfully', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);
      mockBlockBlobClient.getProperties.mockResolvedValue(mockProperties);

      const result = await service.getMetadata(testBlobPath);

      expect(result).toMatchObject({
        name: 'test-file.pdf',
        blobPath: testBlobPath,
        size: 1024,
        contentType: 'application/pdf',
        metadata: { userId: '123' },
      });
    });

    it('should return null when file does not exist', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(false);

      const result = await service.getMetadata(testBlobPath);

      expect(result).toBeNull();
    });

    it('should return null when getting properties fails', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);
      mockBlockBlobClient.getProperties.mockRejectedValue(new Error('Failed'));

      const result = await service.getMetadata(testBlobPath);

      expect(result).toBeNull();
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.getMetadata(testBlobPath)).rejects.toThrow(InternalServerException);
    });
  });

  describe('copy', () => {
    const sourcePath = 'source/file.pdf';
    const destPath = 'dest/file.pdf';

    beforeEach(() => {
      mockBlockBlobClient.exists.mockResolvedValue(true);
      mockBlockBlobClient.beginCopyFromURL.mockResolvedValue({});
    });

    it('should copy a file successfully', async () => {
      const result = await service.copy(sourcePath, destPath);

      expect(result).toBe(destPath);
      expect(mockBlockBlobClient.beginCopyFromURL).toHaveBeenCalled();
      expect(loggerService.log).toHaveBeenCalledWith('Document copied', {
        source: sourcePath,
        destination: destPath,
      });
    });

    it('should throw BadRequestException when source does not exist', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(false);

      await expect(service.copy(sourcePath, destPath)).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.copy(sourcePath, destPath)).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when copy fails', async () => {
      mockBlockBlobClient.beginCopyFromURL.mockRejectedValue(new Error('Copy failed'));

      await expect(service.copy(sourcePath, destPath)).rejects.toThrow(InternalServerException);
    });
  });

  describe('file validation', () => {
    beforeEach(() => {
      mockBlockBlobClient.upload.mockResolvedValue({});
    });

    it('should accept files when allowedMimeTypes is empty', async () => {
      // Reconfigure with empty allowed types
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'storage.allowedMimeTypes') return [];
        return defaultConfig[key] ?? defaultValue;
      });

      // Need to recreate service with new config
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DocumentService,
          { provide: ConfigService, useValue: configService },
          { provide: LoggerService, useValue: loggerService },
          { provide: DocumentConnectionService, useValue: connectionService },
        ],
      }).compile();

      const newService = module.get<DocumentService>(DocumentService);
      const result = await newService.upload(
        Buffer.from('test'),
        'test.xyz',
        'application/unknown',
      );

      expect(result.mimeType).toBe('application/unknown');
    });
  });

  describe('file name sanitization', () => {
    beforeEach(() => {
      mockBlockBlobClient.upload.mockResolvedValue({});
    });

    it('should sanitize path separators in file names', async () => {
      const result = await service.upload(
        Buffer.from('test'),
        'path/to\\file.pdf',
        'application/pdf',
        { generateUniqueName: false },
      );

      expect(result.storedName).not.toContain('/');
      expect(result.storedName).not.toContain('\\');
    });

    it('should remove leading dots from file names', async () => {
      const result = await service.upload(
        Buffer.from('test'),
        '...file.pdf',
        'application/pdf',
        { generateUniqueName: false },
      );

      expect(result.storedName).not.toMatch(/^\./);
    });

    it('should handle file names with only special characters', async () => {
      const result = await service.upload(
        Buffer.from('test'),
        '...',
        'application/pdf',
        { generateUniqueName: false },
      );

      expect(result.storedName).toContain('file_');
    });

    it('should collapse multiple underscores', async () => {
      const result = await service.upload(
        Buffer.from('test'),
        'file___name.pdf',
        'application/pdf',
        { generateUniqueName: false },
      );

      expect(result.storedName).not.toContain('___');
    });
  });

  describe('path sanitization', () => {
    beforeEach(() => {
      mockBlockBlobClient.upload.mockResolvedValue({});
    });

    it('should remove leading and trailing slashes from folder path', async () => {
      const result = await service.upload(
        Buffer.from('test'),
        'file.pdf',
        'application/pdf',
        { folder: '/folder/path/' },
      );

      expect(result.blobPath).toMatch(/^folder\/path\//);
    });

    it('should remove path traversal attempts', async () => {
      const result = await service.upload(
        Buffer.from('test'),
        'file.pdf',
        'application/pdf',
        { folder: '../../../etc' },
      );

      expect(result.blobPath).not.toContain('..');
    });

    it('should collapse multiple slashes', async () => {
      const result = await service.upload(
        Buffer.from('test'),
        'file.pdf',
        'application/pdf',
        { folder: 'folder//path///sub' },
      );

      expect(result.blobPath).not.toContain('//');
    });
  });
});

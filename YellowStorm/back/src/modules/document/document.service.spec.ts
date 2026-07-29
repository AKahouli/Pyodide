import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { DocumentService } from './document.service';
import { DocumentConnectionService, StorageConnectionStatus } from './document-connection.service';
import { LoggerService } from '../logger';
import { BadRequestException, InternalServerException, NotFoundException } from '../exceptions';

/** Drain PutObject Body streams so size transforms run (mirrors real S3 client). */
const consumeBodyIfStream = async (command: { input?: { Body?: unknown } }) => {
  const body = command?.input?.Body;
  if (body instanceof Readable || (body && typeof (body as Readable).pipe === 'function')) {
    const stream = body as Readable;
    stream.resume();
    await finished(stream);
  }
};

// The S3 client's `send` is driven per-command by tests. By default every
// command resolves with an empty object; individual tests override behavior
// for specific command types via `setSendImpl`.
const mockSend = jest.fn();

// Mock AWS S3 SDK: every command is a small class so we can branch on
// `command.constructor.name` inside the `send` mock.
jest.mock('@aws-sdk/client-s3', () => {
  const makeCommand = (name: string) => {
    const cmd = class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    };
    Object.defineProperty(cmd, 'name', { value: name });
    return cmd;
  };

  return {
    S3Client: class {
      send = mockSend;
    },
    PutObjectCommand: makeCommand('PutObjectCommand'),
    GetObjectCommand: makeCommand('GetObjectCommand'),
    DeleteObjectCommand: makeCommand('DeleteObjectCommand'),
    HeadObjectCommand: makeCommand('HeadObjectCommand'),
    CopyObjectCommand: makeCommand('CopyObjectCommand'),
    ListObjectsV2Command: makeCommand('ListObjectsV2Command'),
  };
});

// Mock presigner — returns a deterministic signed URL string.
const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const PUBLIC_URL = 'https://s3.example.com';
const BUCKET = 'documents';

/** Build a 404 NotFound style S3 error. */
const notFoundError = () =>
  Object.assign(new Error('Not Found'), {
    name: 'NotFound',
    $metadata: { httpStatusCode: 404 },
  });

describe('DocumentService', () => {
  let service: DocumentService;
  let connectionService: jest.Mocked<DocumentConnectionService>;
  let configService: jest.Mocked<ConfigService>;
  let loggerService: jest.Mocked<LoggerService>;

  const defaultConfig: Record<string, unknown> = {
    'storage.s3.bucket': BUCKET,
    'storage.maxFileSizeMb': 50,
    'storage.maxFilesPerUpload': 10,
    'storage.sasExpiryMinutes': 60,
    'storage.allowedMimeTypes': ['application/pdf', 'image/png', 'text/plain'],
  };

  /**
   * Convenience: install a `send` implementation that branches on command
   * constructor name. Unhandled commands resolve to `{}`.
   * Stream uploads are drained so byte-counter validation can run.
   */
  const setSendImpl = (handlers: Record<string, () => unknown>) => {
    mockSend.mockImplementation(async (command: { constructor: { name: string }; input?: { Body?: unknown } }) => {
      await consumeBodyIfStream(command);
      const handler = handlers[command.constructor.name];
      if (handler) {
        return Promise.resolve().then(handler);
      }
      return {};
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: drain stream bodies then resolve (mirrors S3 client reading Body).
    mockSend.mockImplementation(async (command: { input?: { Body?: unknown } }) => {
      await consumeBodyIfStream(command);
      return {};
    });
    mockGetSignedUrl.mockResolvedValue('https://s3.example.com/signed-url?sig=mock');

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
      getS3Client: jest.fn().mockReturnValue({ send: mockSend }),
      getBucket: jest.fn().mockReturnValue(BUCKET),
      getPublicUrl: jest.fn().mockReturnValue(PUBLIC_URL),
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
      expect(result.url).toContain(`${PUBLIC_URL}/${BUCKET}/`);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });

    it('should upload a stream successfully', async () => {
      const stream = Readable.from([testFile]);

      const result = await service.upload(stream, testFileName, testMimeType);

      expect(result).toMatchObject({
        originalName: testFileName,
        mimeType: testMimeType,
      });
      expect(mockSend).toHaveBeenCalledWith(
        expect.any(PutObjectCommand),
        expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
      );
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

    it('should include custom metadata in the PutObjectCommand', async () => {
      const options = { metadata: { userId: '123', category: 'reports' } };

      await service.upload(testFile, testFileName, testMimeType, options);

      const putCommand = mockSend.mock.calls
        .map((call) => call[0])
        .find((cmd) => cmd.constructor.name === 'PutObjectCommand');

      expect(putCommand).toBeDefined();
      expect(putCommand.input).toMatchObject({
        Bucket: BUCKET,
        ContentType: testMimeType,
        Metadata: expect.objectContaining({
          userid: '123',
          category: 'reports',
        }),
      });
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.upload(testFile, testFileName, testMimeType)).rejects.toThrow(
        InternalServerException,
      );
    });

    it('should throw BadRequestException for invalid MIME type', async () => {
      await expect(service.upload(testFile, testFileName, 'application/exe')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for file exceeding size limit', async () => {
      const largeFile = Buffer.alloc(60 * 1024 * 1024); // 60MB

      await expect(service.upload(largeFile, testFileName, testMimeType)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for empty file name', async () => {
      await expect(service.upload(testFile, '', testMimeType)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for file name exceeding 255 characters', async () => {
      const longFileName = 'a'.repeat(256) + '.pdf';

      await expect(service.upload(testFile, longFileName, testMimeType)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw InternalServerException when upload fails', async () => {
      setSendImpl({
        PutObjectCommand: () => {
          throw new Error('Upload failed');
        },
      });

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
    const testObjectKey = 'folder/test-file.pdf';
    const testContent = Buffer.from('file content');

    it('should download a file successfully', async () => {
      setSendImpl({
        GetObjectCommand: () => ({ Body: Readable.from([testContent]) }),
      });

      const result = await service.download(testObjectKey);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe(testContent.toString());
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    });

    it('should throw BadRequestException when response has no body', async () => {
      setSendImpl({
        GetObjectCommand: () => ({ Body: undefined }),
      });

      await expect(service.download(testObjectKey)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when file does not exist', async () => {
      setSendImpl({
        GetObjectCommand: () => {
          throw notFoundError();
        },
      });

      await expect(service.download(testObjectKey)).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.download(testObjectKey)).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when download fails', async () => {
      setSendImpl({
        GetObjectCommand: () => {
          throw new Error('Download failed');
        },
      });

      await expect(service.download(testObjectKey)).rejects.toThrow(InternalServerException);
    });
  });

  describe('delete', () => {
    const testObjectKey = 'folder/test-file.pdf';

    it('should delete a file successfully', async () => {
      await service.delete(testObjectKey);

      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
      const deleteCommand = mockSend.mock.calls
        .map((call) => call[0])
        .find((cmd) => cmd.constructor.name === 'DeleteObjectCommand');
      expect(deleteCommand.input).toMatchObject({ Bucket: BUCKET, Key: testObjectKey });
      expect(loggerService.log).toHaveBeenCalledWith('Document deleted', {
        objectKey: testObjectKey,
      });
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.delete(testObjectKey)).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when delete fails', async () => {
      setSendImpl({
        DeleteObjectCommand: () => {
          throw new Error('Delete failed');
        },
      });

      await expect(service.delete(testObjectKey)).rejects.toThrow(InternalServerException);
    });
  });

  describe('deleteMany', () => {
    const testObjectKeys = ['file1.pdf', 'file2.pdf', 'file3.pdf'];

    it('should delete multiple files successfully', async () => {
      await service.deleteMany(testObjectKeys);

      const deleteCalls = mockSend.mock.calls
        .map((call) => call[0])
        .filter((cmd) => cmd.constructor.name === 'DeleteObjectCommand');
      expect(deleteCalls).toHaveLength(3);
    });
  });

  describe('exists', () => {
    const testObjectKey = 'folder/test-file.pdf';

    it('should return true when file exists', async () => {
      setSendImpl({
        HeadObjectCommand: () => ({ ContentLength: 10 }),
      });

      const result = await service.exists(testObjectKey);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('should return false when file does not exist', async () => {
      setSendImpl({
        HeadObjectCommand: () => {
          throw notFoundError();
        },
      });

      const result = await service.exists(testObjectKey);

      expect(result).toBe(false);
    });

    it('should rethrow non-404 errors', async () => {
      setSendImpl({
        HeadObjectCommand: () => {
          throw Object.assign(new Error('Forbidden'), {
            name: 'AccessDenied',
            $metadata: { httpStatusCode: 403 },
          });
        },
      });

      await expect(service.exists(testObjectKey)).rejects.toThrow('Forbidden');
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.exists(testObjectKey)).rejects.toThrow(InternalServerException);
    });
  });

  describe('generateSasUrl', () => {
    const testObjectKey = 'folder/test-file.pdf';

    it('should generate a presigned URL successfully', async () => {
      const result = await service.generateSasUrl(testObjectKey);

      expect(result).toBe('https://s3.example.com/signed-url?sig=mock');
      expect(mockGetSignedUrl).toHaveBeenCalled();
    });

    it('should sign a GetObjectCommand for read permissions', async () => {
      await service.generateSasUrl(testObjectKey, { permissions: 'r' });

      const command = mockGetSignedUrl.mock.calls[0][1];
      expect(command.constructor.name).toBe('GetObjectCommand');
    });

    it('should sign a PutObjectCommand for write permissions', async () => {
      await service.generateSasUrl(testObjectKey, { permissions: 'w' });

      const command = mockGetSignedUrl.mock.calls[0][1];
      expect(command.constructor.name).toBe('PutObjectCommand');
    });

    it('should sign a PutObjectCommand for create permissions', async () => {
      await service.generateSasUrl(testObjectKey, { permissions: 'c' });

      const command = mockGetSignedUrl.mock.calls[0][1];
      expect(command.constructor.name).toBe('PutObjectCommand');
    });

    it('should use custom expiry minutes', async () => {
      await service.generateSasUrl(testObjectKey, { expiryMinutes: 30 });

      const opts = mockGetSignedUrl.mock.calls[0][2];
      expect(opts).toMatchObject({ expiresIn: 30 * 60 });
    });

    it('should include content disposition', async () => {
      await service.generateSasUrl(testObjectKey, {
        contentDisposition: 'attachment; filename="test.pdf"',
      });

      const command = mockGetSignedUrl.mock.calls[0][1];
      expect(command.input).toMatchObject({
        ResponseContentDisposition: 'attachment; filename="test.pdf"',
      });
    });

    it('should reject keys without an extension (folders)', async () => {
      await expect(service.generateSasUrl('folder/subfolder')).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.generateSasUrl(testObjectKey)).rejects.toThrow(InternalServerException);
    });

    it('should check object existence when checkExists is true', async () => {
      setSendImpl({
        HeadObjectCommand: () => ({ ContentLength: 10 }),
      });

      const result = await service.generateSasUrl(testObjectKey, { checkExists: true });

      expect(result).toBeDefined();
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('should throw NotFoundException when checkExists is true and object does not exist', async () => {
      setSendImpl({
        HeadObjectCommand: () => {
          throw notFoundError();
        },
      });

      await expect(
        service.generateSasUrl(testObjectKey, { checkExists: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    const mockContents = [
      {
        Key: 'folder/file1.pdf',
        Size: 1024,
        LastModified: new Date('2024-01-01'),
      },
      {
        Key: 'folder/file2.png',
        Size: 2048,
        LastModified: new Date('2024-01-02'),
      },
    ];

    it('should list documents successfully', async () => {
      setSendImpl({
        ListObjectsV2Command: () => ({
          Contents: mockContents,
          NextContinuationToken: 'next-token',
        }),
      });

      const result = await service.list();

      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].name).toBe('file1.pdf');
      expect(result.documents[0].blobPath).toBe('folder/file1.pdf');
      expect(result.documents[0].size).toBe(1024);
      expect(result.continuationToken).toBe('next-token');
      expect(mockSend).toHaveBeenCalledWith(expect.any(ListObjectsV2Command));
    });

    it('should filter by folder prefix', async () => {
      setSendImpl({ ListObjectsV2Command: () => ({ Contents: [] }) });

      await service.list({ folder: 'folder/' });

      const command = mockSend.mock.calls
        .map((call) => call[0])
        .find((cmd) => cmd.constructor.name === 'ListObjectsV2Command');
      expect(command.input).toMatchObject({ Prefix: 'folder/' });
    });

    it('should use max results option', async () => {
      setSendImpl({ ListObjectsV2Command: () => ({ Contents: [] }) });

      await service.list({ maxResults: 50 });

      const command = mockSend.mock.calls
        .map((call) => call[0])
        .find((cmd) => cmd.constructor.name === 'ListObjectsV2Command');
      expect(command.input).toMatchObject({ MaxKeys: 50 });
    });

    it('should use continuation token', async () => {
      setSendImpl({ ListObjectsV2Command: () => ({ Contents: [] }) });

      await service.list({ continuationToken: 'prev-token' });

      const command = mockSend.mock.calls
        .map((call) => call[0])
        .find((cmd) => cmd.constructor.name === 'ListObjectsV2Command');
      expect(command.input).toMatchObject({ ContinuationToken: 'prev-token' });
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.list()).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when list fails', async () => {
      setSendImpl({
        ListObjectsV2Command: () => {
          throw new Error('List failed');
        },
      });

      await expect(service.list()).rejects.toThrow(InternalServerException);
    });

    it('should handle empty result', async () => {
      setSendImpl({
        ListObjectsV2Command: () => ({ Contents: undefined }),
      });

      const result = await service.list();

      expect(result.documents).toHaveLength(0);
    });
  });

  describe('getMetadata', () => {
    const testObjectKey = 'folder/test-file.pdf';

    it('should get metadata successfully', async () => {
      setSendImpl({
        HeadObjectCommand: () => ({
          ContentLength: 1024,
          ContentType: 'application/pdf',
          LastModified: new Date('2024-01-01'),
          Metadata: { userid: '123' },
        }),
      });

      const result = await service.getMetadata(testObjectKey);

      expect(result).toMatchObject({
        name: 'test-file.pdf',
        blobPath: testObjectKey,
        size: 1024,
        contentType: 'application/pdf',
        metadata: { userid: '123' },
      });
    });

    it('should return null when file does not exist', async () => {
      setSendImpl({
        HeadObjectCommand: () => {
          throw notFoundError();
        },
      });

      const result = await service.getMetadata(testObjectKey);

      expect(result).toBeNull();
    });

    it('should return null when getting metadata fails', async () => {
      setSendImpl({
        HeadObjectCommand: () => {
          throw new Error('Failed');
        },
      });

      const result = await service.getMetadata(testObjectKey);

      expect(result).toBeNull();
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.getMetadata(testObjectKey)).rejects.toThrow(InternalServerException);
    });
  });

  describe('copy', () => {
    const sourceKey = 'source/file.pdf';
    const destKey = 'dest/file.pdf';

    it('should copy a file successfully', async () => {
      setSendImpl({
        HeadObjectCommand: () => ({ ContentLength: 10 }), // source exists
        CopyObjectCommand: () => ({}),
      });

      const result = await service.copy(sourceKey, destKey);

      expect(result).toBe(destKey);
      expect(mockSend).toHaveBeenCalledWith(expect.any(CopyObjectCommand));
      const copyCommand = mockSend.mock.calls
        .map((call) => call[0])
        .find((cmd) => cmd.constructor.name === 'CopyObjectCommand');
      expect(copyCommand.input).toMatchObject({ Bucket: BUCKET, Key: destKey });
      expect(loggerService.log).toHaveBeenCalledWith('Document copied', {
        source: sourceKey,
        destination: destKey,
      });
    });

    it('should throw BadRequestException when source does not exist', async () => {
      setSendImpl({
        HeadObjectCommand: () => {
          throw notFoundError();
        },
      });

      await expect(service.copy(sourceKey, destKey)).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerException when service is not available', async () => {
      connectionService.isConnectedNow.mockReturnValue(false);

      await expect(service.copy(sourceKey, destKey)).rejects.toThrow(InternalServerException);
    });

    it('should throw InternalServerException when copy fails', async () => {
      setSendImpl({
        HeadObjectCommand: () => ({ ContentLength: 10 }), // source exists
        CopyObjectCommand: () => {
          throw new Error('Copy failed');
        },
      });

      await expect(service.copy(sourceKey, destKey)).rejects.toThrow(InternalServerException);
    });
  });

  describe('getBlobUrl', () => {
    it('should return the canonical object URL', () => {
      const url = service.getBlobUrl('folder/file.pdf');
      expect(url).toBe(`${PUBLIC_URL}/${BUCKET}/folder/file.pdf`);
    });

    it('should throw InternalServerException when service is not available', () => {
      connectionService.isConnectedNow.mockReturnValue(false);
      expect(() => service.getBlobUrl('folder/file.pdf')).toThrow(InternalServerException);
    });
  });

  describe('file validation', () => {
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
      const result = await service.upload(Buffer.from('test'), '...', 'application/pdf', {
        generateUniqueName: false,
      });

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
    it('should remove leading and trailing slashes from folder path', async () => {
      const result = await service.upload(Buffer.from('test'), 'file.pdf', 'application/pdf', {
        folder: '/folder/path/',
      });

      expect(result.blobPath).toMatch(/^folder\/path\//);
    });

    it('should remove path traversal attempts', async () => {
      const result = await service.upload(Buffer.from('test'), 'file.pdf', 'application/pdf', {
        folder: '../../../etc',
      });

      expect(result.blobPath).not.toContain('..');
    });

    it('should collapse multiple slashes', async () => {
      const result = await service.upload(Buffer.from('test'), 'file.pdf', 'application/pdf', {
        folder: 'folder//path///sub',
      });

      expect(result.blobPath).not.toContain('//');
    });
  });
});

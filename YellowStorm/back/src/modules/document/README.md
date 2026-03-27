# Document Module

Global document upload module for Azure Blob Storage with production-grade security and file handling.

## Features

- **Azure Blob Storage Integration**: Native Azure SDK with optimized settings
- **File Validation**: MIME type, file size, and filename validation
- **Secure Uploads**: Sanitized filenames, path traversal prevention
- **SAS URL Generation**: Time-limited secure access URLs
- **Folder Organization**: Organize documents by custom paths
- **Metadata Support**: Attach custom metadata to documents
- **Content Hashing**: MD5 hash for integrity verification
- **Batch Operations**: Upload/delete multiple files at once
- **Graceful Degradation**: Service continues if Azure is not configured

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AZURE_STORAGE_CONNECTION_STRING` | - | Azure Storage connection string |
| `AZURE_STORAGE_CONTAINER_NAME` | `documents` | Blob container name |
| `AZURE_STORAGE_ACCOUNT_NAME` | - | Storage account name (for SAS) |
| `STORAGE_MAX_FILE_SIZE_MB` | `50` | Maximum file size in MB |
| `STORAGE_MAX_FILES_PER_UPLOAD` | `10` | Max files per batch upload |
| `STORAGE_SAS_EXPIRY_MINUTES` | `60` | Default SAS URL expiry |
| `STORAGE_ALLOWED_MIME_TYPES` | See below | Comma-separated MIME types |

### Default Allowed MIME Types

```
application/pdf
application/msword
application/vnd.openxmlformats-officedocument.wordprocessingml.document
text/plain
text/csv
application/json
image/png
image/jpeg
image/gif
image/webp
```

## Usage

### Inject DocumentService

```typescript
import { Injectable } from '@nestjs/common';
import { DocumentService, UploadedDocument } from '@modules/document';

@Injectable()
export class MyService {
  constructor(private readonly documentService: DocumentService) {}
}
```

### Upload a Document

```typescript
// From buffer (e.g., from multer)
const result = await this.documentService.upload(
  file.buffer,
  file.originalname,
  file.mimetype,
  {
    folder: `users/${userId}/documents`,
    metadata: {
      uploadedBy: userId,
      category: 'contract',
    },
  },
);

// Returns:
// {
//   id: 'uuid',
//   originalName: 'contract.pdf',
//   storedName: 'uuid-contract.pdf',
//   blobPath: 'users/123/documents/uuid-contract.pdf',
//   mimeType: 'application/pdf',
//   size: 102400,
//   contentHash: 'md5hash',
//   url: 'https://account.blob.core.windows.net/...',
//   uploadedAt: Date,
//   metadata: { ... }
// }
```

### Upload Multiple Documents

```typescript
const files = [
  { buffer: file1.buffer, originalName: 'doc1.pdf', mimeType: 'application/pdf' },
  { buffer: file2.buffer, originalName: 'doc2.pdf', mimeType: 'application/pdf' },
];

const results = await this.documentService.uploadMany(files, {
  folder: 'batch-uploads',
});
```

### Download a Document

```typescript
const buffer = await this.documentService.download('users/123/documents/file.pdf');

// Use in controller
@Get(':path(*)')
async download(@Param('path') path: string, @Res() res: Response) {
  const buffer = await this.documentService.download(path);
  const metadata = await this.documentService.getMetadata(path);

  res.setHeader('Content-Type', metadata.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${metadata.name}"`);
  res.send(buffer);
}
```

### Generate SAS URL (Temporary Access)

```typescript
// Default expiry (from config)
const url = this.documentService.generateSasUrl('path/to/file.pdf');

// Custom expiry and permissions
const url = this.documentService.generateSasUrl('path/to/file.pdf', {
  expiryMinutes: 15,
  permissions: 'r', // read only
  contentDisposition: 'attachment; filename="download.pdf"',
});
```

### Delete Documents

```typescript
// Single delete
await this.documentService.delete('path/to/file.pdf');

// Batch delete
await this.documentService.deleteMany([
  'path/to/file1.pdf',
  'path/to/file2.pdf',
]);
```

### List Documents

```typescript
const result = await this.documentService.list({
  folder: 'users/123/documents',
  maxResults: 50,
});

// Pagination
const nextPage = await this.documentService.list({
  folder: 'users/123/documents',
  continuationToken: result.continuationToken,
});
```

### Check Document Exists

```typescript
const exists = await this.documentService.exists('path/to/file.pdf');
```

### Copy Document

```typescript
const newPath = await this.documentService.copy(
  'temp/upload.pdf',
  'permanent/document.pdf',
);
```

### Check Service Availability

```typescript
if (!this.documentService.isAvailable()) {
  throw new ServiceUnavailableException('Document storage not configured');
}
```

## Folder Organization Patterns

### By User
```typescript
{ folder: `users/${userId}/documents` }
// Result: users/123/documents/uuid-file.pdf
```

### By Date
```typescript
const date = new Date().toISOString().split('T')[0];
{ folder: `uploads/${date}` }
// Result: uploads/2024-01-15/uuid-file.pdf
```

### By Type
```typescript
{ folder: `documents/${documentType}` }
// Result: documents/contracts/uuid-file.pdf
```

### Nested Structure
```typescript
{ folder: `organizations/${orgId}/projects/${projectId}/files` }
// Result: organizations/456/projects/789/files/uuid-file.pdf
```

## Security Features

### Filename Sanitization
- Removes path separators (`/`, `\`, `:`)
- Removes null bytes
- Strips leading/trailing dots and spaces
- Prevents path traversal attacks

### Path Sanitization
- Removes `..` sequences
- Normalizes slashes
- Removes null bytes

### MIME Type Validation
- Validates against allowed list
- Prevents upload of executable files
- Configurable per environment

### Content Hashing
- MD5 hash calculated for every upload
- Can be used for deduplication
- Stored in blob metadata

## Integration with Controllers

### File Upload Endpoint

```typescript
import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from '@modules/document';

@Controller('files')
export class FilesController {
  constructor(private readonly documentService: DocumentService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    return this.documentService.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }
}
```

### Multiple File Upload

```typescript
@Post('upload-many')
@UseInterceptors(FilesInterceptor('files', 10))
async uploadMany(@UploadedFiles() files: Express.Multer.File[]) {
  return this.documentService.uploadMany(
    files.map(f => ({
      buffer: f.buffer,
      originalName: f.originalname,
      mimeType: f.mimetype,
    })),
  );
}
```

## Azure Setup

### Create Storage Account

1. Go to Azure Portal
2. Create a Storage Account
3. Note the account name and access keys

### Get Connection String

1. Go to Storage Account → Access keys
2. Copy the connection string

### Configure CORS (if needed for direct uploads)

1. Go to Storage Account → Resource sharing (CORS)
2. Add allowed origins, methods, and headers

## Error Handling

The service throws these exceptions:

| Exception | When |
|-----------|------|
| `BadRequestException` | Invalid file type, size exceeded, file not found |
| `InternalServerErrorException` | Azure connection failed, upload/download failed |

## Health Check Integration

```typescript
// In HealthService
private async checkStorage(): Promise<HealthCheckDetail> {
  return {
    status: this.documentService.isAvailable() ? 'up' : 'down',
    message: this.documentService.isAvailable()
      ? 'Azure Blob Storage connected'
      : 'Azure Blob Storage not configured',
  };
}
```

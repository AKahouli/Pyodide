import { IsString, IsOptional, IsNotEmpty, IsIn, IsArray, ValidateIf, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportConnectorItemDto {
  @ApiProperty({ description: 'Connector slug or ID (e.g. m365, gdrive)' })
  @IsString()
  @IsNotEmpty()
  connectorId!: string;

  @ApiProperty({
    description: 'Item reference from connector (connector-specific)',
    example: '{"driveId":"...","itemId":"..."}',
    required: false,
  })
  @ValidateIf((o) => o.mode !== 'files')
  itemRef?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Multiple item references from connector for batch import',
    type: 'array',
    example: [{ driveId: '...', itemId: '...' }],
  })
  @ValidateIf((o) => o.mode === 'files')
  @IsArray()
  itemRefs?: Record<string, unknown>[];

  @ApiProperty({ description: 'Target workspace ID' })
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @ApiPropertyOptional({ enum: ['file', 'files', 'folder'], default: 'file' })
  @IsOptional()
  @IsString()
  @IsIn(['file', 'files', 'folder'])
  mode?: 'file' | 'files' | 'folder';

  @ApiPropertyOptional({ description: 'Recursively import folder contents', default: true })
  @IsOptional()
  @IsBoolean()
  recursive?: boolean;

  @ApiPropertyOptional({ description: 'Flatten imported folder contents into workspace files', default: true })
  @IsOptional()
  @IsBoolean()
  flatten?: boolean;

  @ApiPropertyOptional({ description: 'Override filename for the imported document' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ description: 'Override MIME type' })
  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class ExportToConnectorDto {
  @ApiProperty({ description: 'Connector slug or ID' })
  @IsString()
  @IsNotEmpty()
  connectorId!: string;

  @ApiProperty({ description: 'Target location in connector' })
  targetRef!: Record<string, unknown>;

  @ApiProperty({ description: 'Workspace ID containing the source document' })
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @ApiProperty({ description: 'Workspace document ID to export' })
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @ApiPropertyOptional({ description: 'Mode: create new file or update existing', enum: ['create', 'update'], default: 'create' })
  @IsOptional()
  @IsString()
  mode?: 'create' | 'update';

  @ApiPropertyOptional({ description: 'Filename for the new file (create mode only)' })
  @IsOptional()
  @IsString()
  filename?: string;
}

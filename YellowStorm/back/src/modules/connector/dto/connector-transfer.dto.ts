import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportConnectorItemDto {
  @ApiProperty({ description: 'Connector slug or ID (e.g. m365, gdrive)' })
  @IsString()
  @IsNotEmpty()
  connectorId!: string;

  @ApiProperty({
    description: 'Item reference from connector (connector-specific)',
    example: '{"driveId":"...","itemId":"..."}',
  })
  itemRef!: Record<string, unknown>;

  @ApiProperty({ description: 'Target workspace ID' })
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

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

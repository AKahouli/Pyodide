import { IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IndexingWebhookMetadataDto {
  @ApiProperty({ description: 'Document ID (external_id sent during indexing)' })
  @IsString()
  external_id!: string;

  @ApiProperty({ description: 'Workspace ID (brain_id sent during indexing)' })
  @IsString()
  brain_id!: string;

  @ApiPropertyOptional({ description: 'Source URL of the document' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class IndexingWebhookDto {
  @ApiProperty({ description: 'Event type (e.g. "indexation_task")' })
  @IsString()
  event_type!: string;

  @ApiProperty({ description: 'Task ID from the indexing API' })
  @IsString()
  task_id!: string;

  @ApiProperty({ description: 'Metadata containing document and workspace IDs' })
  @ValidateNested()
  @Type(() => IndexingWebhookMetadataDto)
  metadata!: IndexingWebhookMetadataDto;

  @ApiProperty({ description: 'Status of the indexing task (e.g. "FINISH", "ERROR")' })
  @IsString()
  status!: string;
}

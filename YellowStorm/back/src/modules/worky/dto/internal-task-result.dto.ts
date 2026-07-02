import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalTaskResultDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  status!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({ description: 'Opaque payload (artifactId, contentRef, …)' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'WorkspaceDocument id carrying the result content' })
  @IsOptional()
  @IsString()
  contentArtifactId?: string;

  @ApiPropertyOptional({ description: 'Ephemeral worker id that produced the result' })
  @IsOptional()
  @IsString()
  createdByWorkerId?: string;
}

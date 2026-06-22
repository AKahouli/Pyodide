import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalArtifactDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({ description: 'URI under the artifact workspace where the file was written' })
  @IsString()
  @IsNotEmpty()
  uri!: string;

  @ApiPropertyOptional({ description: 'Optional task binding' })
  @IsOptional()
  @IsString()
  taskId?: string;

  @ApiPropertyOptional({ description: 'Opaque metadata (mime, size, …)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

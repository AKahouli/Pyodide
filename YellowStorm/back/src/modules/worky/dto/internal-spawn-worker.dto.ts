import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalSpawnWorkerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({ description: 'Stream-relative task id' })
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @ApiPropertyOptional({ description: 'Role the worker should play' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @ApiPropertyOptional({
    description: 'Connector/skill/tool refs the worker should be bound to (Part 3 §3.5)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  toolRefs?: string[];
}

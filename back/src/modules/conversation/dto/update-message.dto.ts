import { IsString, IsArray, IsMongoId, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMessageDto {
  @ApiProperty({ maxLength: 50000 })
  @IsString()
  @MaxLength(50000)
  content!: string;

  @ApiPropertyOptional({ description: 'Agent IDs mentioned in the message', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  agentIds?: string[];

  @ApiPropertyOptional({ description: 'Member IDs mentioned in the message', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  memberIds?: string[];
}

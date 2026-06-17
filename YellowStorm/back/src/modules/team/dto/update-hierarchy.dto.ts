import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TeamMemberDto {
  @ApiProperty({ description: 'Agent ID (MongoDB ObjectId)' })
  @IsMongoId()
  agentId!: string;

  @ApiPropertyOptional({ description: 'Parent agent ID (null = root node)', default: null })
  @IsOptional()
  @IsMongoId()
  parentAgentId?: string | null;

  @ApiPropertyOptional({ description: 'Sort order among siblings', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional({ description: 'X coordinate for org chart rendering', default: 0 })
  @IsOptional()
  @IsNumber()
  positionX?: number;

  @ApiPropertyOptional({ description: 'Y coordinate for org chart rendering', default: 0 })
  @IsOptional()
  @IsNumber()
  positionY?: number;
}

export class UpdateHierarchyDto {
  @ApiProperty({ description: 'Full members array (replaces existing)', type: [TeamMemberDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamMemberDto)
  members!: TeamMemberDto[];
}

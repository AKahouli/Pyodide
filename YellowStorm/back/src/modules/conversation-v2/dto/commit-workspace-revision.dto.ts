import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CommitWorkspaceRevisionFileDto {
  @ApiProperty({ example: 'src/App.jsx' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  path!: string;

  @ApiProperty({ description: 'UTF-8 text file content' })
  @IsString()
  content!: string;
}

export class CommitWorkspaceRevisionDto {
  @ApiProperty({ example: 'rev_3' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  revisionId!: string;

  @ApiPropertyOptional({ example: 'starter_react_vite_v1', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  parentRevisionId?: string | null;

  @ApiProperty({ type: [CommitWorkspaceRevisionFileDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommitWorkspaceRevisionFileDto)
  files!: CommitWorkspaceRevisionFileDto[];

  @ApiPropertyOptional({ description: 'Originating runtime tool call id' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  toolCallId?: string | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
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

  @ApiProperty({
    description: 'File body: UTF-8 text by default, or base64 when encoding=base64',
  })
  @IsString()
  content!: string;

  @ApiPropertyOptional({
    enum: ['utf8', 'base64'],
    description: 'Content encoding. Defaults to utf8.',
  })
  @IsOptional()
  @IsIn(['utf8', 'base64'])
  encoding?: 'utf8' | 'base64';
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

  /**
   * Complete set of paths present in the workspace VFS. When set, the new
   * revision is parent ∩ presentPaths ⊕ uploaded bodies — so template binaries
   * survive text-only commits, and deletions (path absent here) stick.
   */
  @ApiPropertyOptional({ type: [String], example: ['package.json', 'src/assets/hero.png'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  presentPaths?: string[];

  @ApiPropertyOptional({ description: 'Originating runtime tool call id' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  toolCallId?: string | null;
}

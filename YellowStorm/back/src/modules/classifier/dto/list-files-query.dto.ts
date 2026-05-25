import { IsBooleanString, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListFilesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by classifier folder id' })
  @IsOptional()
  @IsMongoId()
  folderId?: string;

  @ApiPropertyOptional({ description: 'Return only unclassified files (folderId === null)' })
  @IsOptional()
  @IsBooleanString()
  unclassified?: string;

  @ApiPropertyOptional({ description: 'Free-text search on file name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

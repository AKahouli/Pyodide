import { IsMongoId, IsOptional, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MoveFolderDto {
  @ApiPropertyOptional({ description: 'New parent folder id (null for root)', nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsMongoId()
  parentId!: string | null;
}

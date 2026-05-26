import { IsMongoId, IsOptional, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AssignFileDto {
  @ApiPropertyOptional({
    description: 'Target folder id, or null to unclassify the file',
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsMongoId()
  folderId!: string | null;
}

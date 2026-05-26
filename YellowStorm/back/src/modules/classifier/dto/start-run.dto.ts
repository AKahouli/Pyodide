import { IsBoolean, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartRunDto {
  @ApiProperty({ description: 'Playbook id to run for classification' })
  @IsMongoId()
  playbookId!: string;

  @ApiPropertyOptional({
    description: 'Optional natural-language instruction to bias the classifier',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  hint?: string;

  @ApiPropertyOptional({
    description:
      'When true, reclassify files that already have a folder. Default false (only unclassified files are processed).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

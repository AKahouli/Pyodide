import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOutputFormatTemplateDto {
  @ApiProperty({
    description: 'Editable output format guide for the active template',
    required: false,
  })
  @IsString()
  @MaxLength(12000)
  @IsOptional()
  formatGuide?: string;
}

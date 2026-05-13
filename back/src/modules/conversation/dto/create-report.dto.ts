import { IsString, IsIn, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReportDto {
  @ApiProperty({ enum: ['inaccurate', 'wrong_information', 'offensive', 'out_of_context', 'hallucination', 'other'] })
  @IsIn(['inaccurate', 'wrong_information', 'offensive', 'out_of_context', 'hallucination', 'other'])
  reason!: 'inaccurate' | 'wrong_information' | 'offensive' | 'out_of_context' | 'hallucination' | 'other';

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  description!: string;
}

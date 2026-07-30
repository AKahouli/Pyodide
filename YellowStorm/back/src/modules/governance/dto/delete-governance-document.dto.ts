import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class DeleteGovernanceDocumentDto {
  @ApiProperty({ description: 'Explicit acknowledgement that operational governance records will be removed.' }) @IsBoolean() confirm!: boolean;
}

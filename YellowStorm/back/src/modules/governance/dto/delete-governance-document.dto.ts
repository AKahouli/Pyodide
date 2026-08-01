import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, Min } from 'class-validator';

export class DeleteGovernanceDocumentDto {
  @ApiProperty({ description: 'Explicit acknowledgement that operational governance records will be removed.' }) @IsBoolean() confirm!: boolean;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedGovernanceRevision!: number;
}

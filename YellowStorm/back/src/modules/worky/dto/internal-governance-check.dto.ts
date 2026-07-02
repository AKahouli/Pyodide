import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WORKY_GOVERNANCE_LEVELS } from '../constants/worky.constants';

export class InternalGovernanceCheckDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({ description: 'Action category to resolve' })
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ApiProperty({ enum: WORKY_GOVERNANCE_LEVELS, description: 'Override level proposed by the runtime' })
  @IsIn(WORKY_GOVERNANCE_LEVELS as unknown as string[])
  overrideLevel!: string;
}

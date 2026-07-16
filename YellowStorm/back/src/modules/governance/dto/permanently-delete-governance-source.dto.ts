import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class PermanentlyDeleteGovernanceSourceDto {
  @ApiProperty({ description: 'Explicit acknowledgement that versions and source events will be removed.' })
  @IsBoolean()
  confirm!: boolean;
}

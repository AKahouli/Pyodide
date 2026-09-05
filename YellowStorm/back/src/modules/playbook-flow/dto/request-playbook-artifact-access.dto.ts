import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export type PlaybookArtifactAction = 'view' | 'download';

export class RequestPlaybookArtifactAccessDto {
  @ApiProperty({ enum: ['view', 'download'] })
  @IsIn(['view', 'download'])
  action!: PlaybookArtifactAction;
}

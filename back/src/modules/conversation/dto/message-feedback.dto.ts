import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MessageFeedbackDto {
  @ApiProperty({ enum: ['like', 'dislike'] })
  @IsIn(['like', 'dislike'])
  feedback!: 'like' | 'dislike';
}

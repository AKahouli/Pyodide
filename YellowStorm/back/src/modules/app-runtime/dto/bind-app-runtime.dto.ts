import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class BindAppRuntimeDto {
  @ApiProperty({
    description: 'Conversation V2 session id. Doubles as the workspace id for the MVP.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  conversationSessionId!: string;

  @ApiProperty({ description: 'Owner of the conversation session.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  userId!: string;
}

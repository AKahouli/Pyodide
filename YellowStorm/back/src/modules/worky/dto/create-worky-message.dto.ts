import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for `POST /worky/streams/{id}/messages`. The role is fixed to
 * `owner` at the controller layer; the runtime tag (a future
 * system-message kind) is not exposed to clients.
 */
export class CreateWorkyMessageDto {
  @ApiProperty({ maxLength: 50000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  content!: string;
}

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(16384)
  message!: string;

  @IsOptional()
  @IsString()
  token?: string;
}

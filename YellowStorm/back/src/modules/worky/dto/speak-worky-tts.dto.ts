import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SpeakWorkyTtsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  text!: string;

  /** Optional voice override (defaults to WORKY_TTS_VOICE). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  voice?: string;
}

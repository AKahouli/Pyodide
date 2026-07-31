import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

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

  /** Playback rate for synthesis, 0.5–2. Omitted = the provider's default. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speed?: number;
}

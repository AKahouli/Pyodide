import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateVoiceSessionDto {
  @IsOptional() @IsString() @MaxLength(512) resumptionHandle?: string;
}

export class VoiceDispatchDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
  @IsString() @IsNotEmpty() @MaxLength(50000) message!: string;
}

export class VoiceStatusDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
}

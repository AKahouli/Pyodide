import { IsIn, IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateVoiceSessionDto {
  @IsOptional() @IsString() @MaxLength(256) streamId?: string;
  @IsOptional() @IsString() @MaxLength(512) resumptionHandle?: string;
}

export class VoicePromptDto {
  @IsString() @MaxLength(8000) prompt!: string;
}

export class VoiceDispatchDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
  @IsString() @IsNotEmpty() @MaxLength(50000) message!: string;
}

export class VoiceStatusDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
}

export class VoiceListTasksDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
}

export class VoiceTaskDetailsDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
  @IsString() @IsNotEmpty() @MaxLength(256) taskId!: string;
}

export class VoiceTranscriptDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
  @IsIn(['owner', 'manager']) role!: 'owner' | 'manager';
  @IsString() @IsNotEmpty() @MaxLength(50000) text!: string;
}

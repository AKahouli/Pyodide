import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ChatMessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
}

export class ChatMessageDto {
  @IsEnum(ChatMessageRole)
  role!: ChatMessageRole;

  @IsString()
  content!: string;
}

export class ChatCompletionDto {
  @IsString()
  model!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  top_p?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  max_tokens?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  max_completion_tokens?: number;

  @IsOptional()
  @IsString({ each: true })
  stop?: string | string[];
}

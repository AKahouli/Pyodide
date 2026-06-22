import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class ShareDeployDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  emails!: string[];

  // Optional fallback URL from the client. The backend prefers the persisted
  // `deployedUrl`; this is used when it isn't set (e.g. the front-only static
  // demo where no real deploy ran).
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}

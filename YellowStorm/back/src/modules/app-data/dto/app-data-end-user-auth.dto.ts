import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AppDataEndUserRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;

  /** Opaque register-invite token from `/register?invite=`. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  inviteToken?: string;
}

export class AppDataEndUserLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

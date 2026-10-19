import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Renewal proves the existing actor rather than accepting a caller-selected subject. */
export class InternalMcpTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  connectorId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  assertion!: string;
}

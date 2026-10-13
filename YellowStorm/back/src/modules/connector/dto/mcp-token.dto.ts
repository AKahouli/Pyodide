import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Only internal authenticated runtimes may specify an acting user. */
export class InternalMcpTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  connectorId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  userId!: string;
}

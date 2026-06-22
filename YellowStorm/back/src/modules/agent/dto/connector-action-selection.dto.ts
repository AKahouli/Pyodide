import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsMongoId, IsString, MaxLength } from 'class-validator';

export class AgentConnectorActionSelectionDto {
  @ApiProperty({ description: 'Connector ID' })
  @IsMongoId()
  connectorId!: string;

  @ApiProperty({ description: 'Allowed connector action keys', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  actionKeys!: string[];
}

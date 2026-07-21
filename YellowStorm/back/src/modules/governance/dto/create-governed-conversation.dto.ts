import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsUUID } from 'class-validator';

export class CreateGovernedConversationDto {
  @ApiProperty() @IsMongoId() scopeId!: string;
  @ApiProperty() @IsUUID() requestId!: string;
}

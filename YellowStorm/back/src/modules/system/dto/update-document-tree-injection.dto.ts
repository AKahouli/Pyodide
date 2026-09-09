import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateDocumentTreeInjectionDto {
  @ApiProperty({ description: 'Whether document and brain trees are injected into agent prompts' })
  @IsBoolean()
  enabled!: boolean;
}

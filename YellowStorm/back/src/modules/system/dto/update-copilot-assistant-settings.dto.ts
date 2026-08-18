import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class UpdateCopilotAssistantSettingsDto {
  @ApiPropertyOptional({
    description: 'Agent that powers the Yellowmind Copilot assistant. Leave null to fall back to the active default Yellowmind agent.',
  })
  @IsOptional()
  @IsMongoId()
  agentId?: string | null;
}

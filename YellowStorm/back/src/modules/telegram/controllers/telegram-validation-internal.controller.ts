import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { TelegramValidationService } from '../services/telegram-validation.service';

class CreateValidationDto {
  @IsMongoId()
  integration_id!: string;

  @IsMongoId()
  conversation_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @IsOptional()
  choices!: string[];

  @IsString()
  @IsOptional()
  @MaxLength(200)
  guest_label?: string;
}

@ApiTags('Telegram (Internal)')
@Controller('telegram/internal')
@Public()
@UseGuards(InternalServiceGuard)
export class TelegramValidationInternalController {
  constructor(private readonly validationService: TelegramValidationService) {}

  @Post('validations')
  @ApiOperation({ summary: 'Ask the bot owner for a validation via Telegram buttons (internal)' })
  @ApiHeader({ name: 'X-Internal-Token', required: true })
  async requestValidation(@Body() dto: CreateValidationDto): Promise<unknown> {
    return this.validationService.create({
      integration_id: dto.integration_id,
      conversation_id: dto.conversation_id,
      question: dto.question,
      choices: dto.choices,
      guest_label: dto.guest_label,
    });
  }
}

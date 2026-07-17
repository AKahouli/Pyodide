import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { normalizeChoiceComponentData } from '../utils/choice-component-normalizer';
import { Message, MessageDocument } from '../schemas/message.schema';
import type { ChoiceInteractionDto } from '../dto/send-message.dto';

export interface CanonicalChoiceSubmission {
  content: string;
  interaction: Record<string, unknown>;
}

@Injectable()
export class ChoiceInteractionService {
  constructor(@InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>) {}

  async canonicalize(conversationId: string, interaction: ChoiceInteractionDto): Promise<CanonicalChoiceSubmission> {
    const source = await this.messageModel.findOne({
      _id: interaction.sourceMessageId,
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
    }).select('components').lean().exec();
    const component = source?.components?.find((item) => item.id === interaction.componentId && item.type === 'choice');
    const choice = component ? normalizeChoiceComponentData(component.data) : null;
    if (!choice || choice.status !== 'ready' || choice.questionId !== interaction.questionId || choice.selectionMode !== interaction.selectionMode) {
      throw this.invalid();
    }

    const selectedIds = interaction.selectedOptions.map((item) => item.optionId);
    const selected = selectedIds.map((id) => choice.options.find((option) => option.id === id));
    if (selected.some((option) => !option || option.disabled)) throw this.invalid();
    const customAnswer = interaction.customAnswer?.trim();
    if (interaction.dismissed) {
      if (!choice.dismissible || selected.length || customAnswer) throw this.invalid();
      return {
        content: 'I prefer not to answer this question.',
        interaction: {
          type: 'choice', componentId: interaction.componentId, questionId: choice.questionId,
          sourceMessageId: interaction.sourceMessageId, selectionMode: choice.selectionMode,
          selectedOptions: [], dismissed: true, displayText: 'Dismissed',
        },
      };
    }
    if (customAnswer && (!choice.otherOption?.enabled || customAnswer.length > choice.otherOption.maxLength)) throw this.invalid();
    if (choice.selectionMode === 'single' && selected.length > 1) throw this.invalid();
    if (choice.selectionMode === 'single' && customAnswer && selected.length) throw this.invalid();
    if (!selected.length && !customAnswer) throw this.invalid();

    const canonicalSelected = selected as NonNullable<(typeof selected)[number]>[];
    const submitParts = canonicalSelected.map((option) => option.submitText);
    const displayParts = canonicalSelected.map((option) => option.label);
    if (customAnswer) { submitParts.push(customAnswer); displayParts.push(customAnswer); }
    return {
      content: submitParts.join(' '),
      interaction: {
        type: 'choice', componentId: interaction.componentId, questionId: choice.questionId,
        sourceMessageId: interaction.sourceMessageId, selectionMode: choice.selectionMode,
        selectedOptions: canonicalSelected.map((option) => ({ optionId: option.id, label: option.label, ...(option.value ? { value: option.value } : {}) })),
        ...(customAnswer ? { customAnswer } : {}), displayText: displayParts.join(', '),
      },
    };
  }

  private invalid(): BadRequestException {
    return new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid choice interaction');
  }
}

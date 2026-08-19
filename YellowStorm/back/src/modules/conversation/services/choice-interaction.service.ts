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
  taskSummary: string;
  interaction: Record<string, unknown>;
}

export interface CanonicalMultiChoiceSubmission {
  content: string;
  taskSummary: string;
  interactions: Record<string, unknown>[];
}

@Injectable()
export class ChoiceInteractionService {
  constructor(@InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>) {}

  async canonicalize(conversationId: string, interaction: ChoiceInteractionDto): Promise<CanonicalChoiceSubmission> {    const source = await this.messageModel.findOne({
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
    const selected = choice.options.filter((option) => selectedIds.includes(option.id));
    if (selected.length !== selectedIds.length || selected.some((option) => option.disabled)) throw this.invalid();
    const customAnswer = interaction.customAnswer?.trim();
    if (interaction.dismissed) {
      if (!choice.dismissible || selected.length || customAnswer) throw this.invalid();
      const displayText = choice.labels?.dismiss ?? 'Dismissed';
      return {
        content: JSON.stringify({
          question: {
            prompt: choice.prompt,
            description: choice.description ?? null,
          },
          selectedChoices: [],
          alternativeResponse: null,
          dismissed: true,
        }, null, 2),
        taskSummary: this.summarize([displayText]),
        interaction: {
          type: 'choice', componentId: interaction.componentId, questionId: choice.questionId,
          sourceMessageId: interaction.sourceMessageId, selectionMode: choice.selectionMode,
          selectedOptions: [], dismissed: true, displayText,
        },
      };
    }
    if (customAnswer && (!choice.otherOption?.enabled || customAnswer.length > choice.otherOption.maxLength)) throw this.invalid();
    if (choice.selectionMode === 'single' && selected.length > 1) throw this.invalid();
    if (choice.selectionMode === 'single' && customAnswer && selected.length) throw this.invalid();
    if (!selected.length && !customAnswer) throw this.invalid();

    const canonicalSelected = selected;
    const displayParts = canonicalSelected.map((option) => option.label);
    if (customAnswer) displayParts.push(customAnswer);
    const content = JSON.stringify({
      question: {
        prompt: choice.prompt,
        description: choice.description ?? null,
      },
      selectedChoices: canonicalSelected.map((option) => ({
        optionId: option.id,
        submitText: option.submitText,
        description: option.description ?? null,
      })),
      alternativeResponse: customAnswer ?? null,
      dismissed: false,
    }, null, 2);
    return {
      content,
      taskSummary: this.summarize(displayParts),
      interaction: {
        type: 'choice', componentId: interaction.componentId, questionId: choice.questionId,
        sourceMessageId: interaction.sourceMessageId, selectionMode: choice.selectionMode,
        selectedOptions: canonicalSelected.map((option) => ({ optionId: option.id, label: option.label, ...(option.value ? { value: option.value } : {}) })),
        ...(customAnswer ? { customAnswer } : {}), displayText: displayParts.join(', '),
      },
    };
  }

  /**
   * Canonicalizes multiple choice answers in one turn. Each answer is validated
   * against its own source choice component; the combined payload preserves each
   * question/answer pair so the agent can resolve all clarifications at once.
   */
  async canonicalizeMany(
    conversationId: string,
    interactions: ChoiceInteractionDto[],
  ): Promise<CanonicalMultiChoiceSubmission> {
    const submissions: CanonicalChoiceSubmission[] = [];
    for (const interaction of interactions) {
      submissions.push(await this.canonicalize(conversationId, interaction));
    }
    const contents = submissions.map((submission) => {
      try {
        return JSON.parse(submission.content) as unknown;
      } catch {
        return submission.content;
      }
    });
    return {
      content: JSON.stringify(contents, null, 2),
      taskSummary: submissions.map((submission) => submission.taskSummary).join(', '),
      interactions: submissions.map((submission) => submission.interaction),
    };
  }

  private summarize(parts: string[]): string {
    const summary = parts.join(', ').replace(/\s+/g, ' ').trim();
    return summary.length <= 120 ? summary : `${summary.slice(0, 117).trimEnd()}...`;
  }

  private invalid(): BadRequestException {
    return new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid choice interaction');
  }
}

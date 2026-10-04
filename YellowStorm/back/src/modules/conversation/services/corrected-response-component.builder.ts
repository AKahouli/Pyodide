import { Injectable } from '@nestjs/common';
import type { MessageComponent } from '../interfaces/message.interface';
import type { ReliabilityAnswerSegment } from './response-reliability-evidence.builder';

@Injectable()
export class CorrectedResponseComponentBuilder {
  build(
    original: MessageComponent[],
    originalSegments: ReliabilityAnswerSegment[],
    correctedSegments: { text: string }[],
  ): MessageComponent[] {
    if (correctedSegments.length !== originalSegments.length) throw new Error('Corrector changed the segment count');
    const correctedById = new Map(originalSegments.map((segment, index) => [segment.componentId, correctedSegments[index].text.trim()]));
    if ([...correctedById.values()].some((text) => !text)) throw new Error('Corrector returned an empty segment');
    return original.map((component) => {
      const corrected = correctedById.get(component.id);
      if (component.type !== 'text' || corrected === undefined) return component;
      const field = typeof component.data.content === 'string' ? 'content' : 'text';
      return { ...component, data: { ...component.data, [field]: corrected } };
    });
  }
}

import type { ChoiceInteractionMetadata, Message } from './types';

/** Indexes the latest valid user choice response by its source component. */
export function buildChoiceInteractionIndex(messages: Message[]): Map<string, ChoiceInteractionMetadata> {
  const interactions = new Map<string, ChoiceInteractionMetadata>();
  for (const message of messages) {
    if (message.conversationType !== 'user') continue;
    const candidates = message.interactions?.length
      ? message.interactions
      : message.interaction
        ? [message.interaction]
        : [];
    for (const interaction of candidates) {
      if (
        interaction?.type !== 'choice' ||
        !interaction.componentId ||
        !Array.isArray(interaction.selectedOptions)
      ) {
        continue;
      }
      interactions.set(interaction.componentId, interaction);
    }
  }
  return interactions;
}

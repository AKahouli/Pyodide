import { describe, expect, it } from 'vitest';
import { chatLibrary } from '@openuidev/thesys';
import { OpenUiTextContent } from './citations';
import { openUiLibrary } from './library';

describe('openUiLibrary', () => {
  it('is the thesys chat library with only its text-bearing renderers swapped, so the generated prompt stays valid', () => {
    expect(JSON.stringify(openUiLibrary.toSpec())).toBe(JSON.stringify(chatLibrary.toSpec()));
    expect(openUiLibrary.root).toBe(chatLibrary.root);
    expect(Object.keys(openUiLibrary.components)).toEqual(Object.keys(chatLibrary.components));
    const swapped = Object.keys(openUiLibrary.components).filter((name) => openUiLibrary.components[name].component !== chatLibrary.components[name].component);
    expect(swapped.sort()).toEqual(['BarChart', 'BoldText', 'CalloutV2', 'Card', 'CompositeCardBlock', 'ContextCardBlock', 'EntityList', 'Form', 'Header', 'HorizontalBarChart', 'IconText', 'Image', 'ImageBlock', 'ImageGallery', 'ImageText', 'ImageTextLarge', 'InlineHeader', 'LineChart', 'List', 'OptionCards', 'OverviewCardBlock', 'Slider', 'SnippetCardBlock', 'StepsItem', 'Table', 'Text', 'TextContent', 'VisualCardBlock']);
    expect(openUiLibrary.components.TextContent.component).toBe(OpenUiTextContent);
  });
});

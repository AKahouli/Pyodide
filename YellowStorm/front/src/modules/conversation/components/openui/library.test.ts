import { describe, expect, it } from 'vitest';
import { chatLibrary } from '@openuidev/thesys';
import { OpenUiTextContent } from './citations';
import { openUiLibrary } from './library';

describe('openUiLibrary', () => {
  it('preserves stock schemas while appending reusable mini-app primitives', () => {
    const stock = chatLibrary.toSpec(); const actual = openUiLibrary.toSpec();
    for (const name of Object.keys(stock.components)) expect(actual.components[name]).toEqual(stock.components[name]);
    expect(openUiLibrary.root).toBe(chatLibrary.root);
    expect(Object.keys(openUiLibrary.components)).toEqual(expect.arrayContaining(Object.keys(chatLibrary.components)));
    expect(Object.keys(openUiLibrary.components).filter(name => !chatLibrary.components[name])).toEqual(['MiniRow', 'MiniColumn', 'MiniGrid', 'MiniPanel', 'MiniText', 'MiniDocument', 'MiniTaskResult', 'MiniApp', 'MiniInput', 'MiniSelect', 'MiniToggle', 'MiniButton', 'MiniOutput', 'MiniList']);
    const swapped = Object.keys(chatLibrary.components).filter((name) => openUiLibrary.components[name].component !== chatLibrary.components[name].component);
    expect(swapped.sort()).toEqual(['BarChart', 'BoldText', 'CalloutV2', 'Card', 'CompositeCardBlock', 'ContextCardBlock', 'EntityList', 'Form', 'Header', 'HorizontalBarChart', 'IconText', 'Image', 'ImageBlock', 'ImageGallery', 'ImageText', 'ImageTextLarge', 'InlineHeader', 'LineChart', 'List', 'OptionCards', 'OverviewCardBlock', 'Slider', 'SnippetCardBlock', 'StepsItem', 'Table', 'Text', 'TextContent', 'VisualCardBlock']);
    expect(openUiLibrary.components.TextContent.component).toBe(OpenUiTextContent);
  });
});

import { describe, expect, it } from 'vitest';
import { openuiLibrary } from '@openuidev/react-ui/genui-lib';
import { OpenUiTextContent } from './citations';
import { openUiLibrary } from './library';

describe('openUiLibrary', () => {
  it('is the stock library with only its text-bearing renderers swapped, so the generated prompt stays valid', () => {
    expect(JSON.stringify(openUiLibrary.toSpec())).toBe(JSON.stringify(openuiLibrary.toSpec()));
    expect(openUiLibrary.root).toBe(openuiLibrary.root);
    const swapped = Object.keys(openUiLibrary.components).filter((name) => openUiLibrary.components[name].component !== openuiLibrary.components[name].component);
    expect(swapped.sort()).toEqual(['Callout', 'CardHeader', 'MarkDownRenderer', 'Steps', 'Table', 'TextContent']);
    expect(openUiLibrary.components.TextContent.component).toBe(OpenUiTextContent);
  });
});

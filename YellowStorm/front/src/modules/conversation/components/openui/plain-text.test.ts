import { describe, expect, it } from 'vitest';
import type { MessageComponent } from '../../types';
import { createOpenUiTextProjector, domToPlainText, isOpenUiProgram, programToPlainText } from './plain-text';
import { componentsToMarkdown } from '../../utils';

const program = 'root = Stack([a])\na = TextContent("Hello")';
const textComponent = (content: string, id = 't'): MessageComponent => ({ id, type: 'text', data: { content } });

function mountMessage(messageId: string, html: string) {
  document.body.innerHTML = `<div id="message-${messageId}">${html}</div>`;
}

describe('isOpenUiProgram', () => {
  it('recognises a program by its root statement only', () => {
    expect(isOpenUiProgram(program)).toBe(true);
    expect(isOpenUiProgram('Plain **markdown** answer')).toBe(false);
    expect(isOpenUiProgram('Use root = x in the config')).toBe(false);
    expect(isOpenUiProgram(undefined)).toBe(false);
  });
});

describe('domToPlainText', () => {
  it('projects blocks, lists, table rows and citation chips into readable text', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div><h3>Summary</h3><p>Revenue grew <span data-citation-ref="2"><button>example.com</button></span>.</p>'
      + '<ul><li>One</li><li>Two</li></ul>'
      + '<table><tbody><tr><th>Country</th><th>GDP</th></tr><tr><td>DE</td><td>4.5</td></tr></tbody></table>'
      + '<svg><text>chart axis</text></svg></div>';
    expect(domToPlainText(host)).toBe('Summary\n\nRevenue grew [2].\n\n- One\n- Two\n\nCountry | GDP\nDE | 4.5');
  });
});

describe('programToPlainText', () => {
  it('keeps the strings of the text-bearing components and drops enums and layout', () => {
    const source = 'root = Stack([h, t, c])\nh = CardHeader("Summary", "Q3")\nt = TextContent("Revenue grew \\"12%\\".", "large")\nc = Callout("warning", "Heads up", "Check [1].")\nb = Button("Go", Action([]))';
    expect(programToPlainText(source)).toBe('Summary\nQ3\n\nRevenue grew "12%".\n\nHeads up\nCheck [1].');
  });

  it('is empty when the program has no text-bearing call', () => {
    expect(programToPlainText('root = Stack([])')).toBe('');
  });
});

describe('createOpenUiTextProjector', () => {
  const prose = textComponent('Let me check **that**.', 'prose');
  const tool = { id: 'tool', type: 'toolActivity', data: {} } as MessageComponent;
  const programPart = textComponent(program, 'prog');

  it('matches each program to its rendered answer by component id, not by count or order', () => {
    mountMessage('m', '<div data-openui-scope data-openui-part="prose"><p>Let me check that.</p></div><div data-openui-scope data-openui-part="prog"><p>Rendered answer</p></div>');
    const components = [prose, tool, programPart];
    const markdown = componentsToMarkdown(components, createOpenUiTextProjector('m', components));
    expect(markdown).toBe('Let me check **that**.\n\nRendered answer');
    expect(markdown).not.toContain('root =');
  });

  it('projects two programs independently, whatever order they sit in the DOM', () => {
    mountMessage('m', '<div data-openui-scope data-openui-part="b"><p>Second answer</p></div><div data-openui-scope data-openui-part="a"><p>First answer</p></div>');
    const components = [textComponent(program, 'a'), { id: 'x', type: 'code', data: { content: 'x', language: 'ts' } } as MessageComponent, textComponent(program, 'b')];
    expect(componentsToMarkdown(components, createOpenUiTextProjector('m', components))).toBe('First answer\n\n```ts\nx\n```\n\nSecond answer');
  });

  it('keeps the stored text when the answer fell back to markdown, because that is what the reader sees', () => {
    mountMessage('m', '<div data-openui-fallback="prog"><p>root = Stack([a])</p></div>');
    const components = [programPart];
    expect(componentsToMarkdown(components, createOpenUiTextProjector('m', components))).toBe(program);
  });

  it('falls back to a readable best effort when the program is not on screen', () => {
    document.body.innerHTML = '';
    const components = [prose, textComponent(program, 'prog')];
    expect(componentsToMarkdown(components, createOpenUiTextProjector('m', components))).toBe('Let me check **that**.\n\nHello');
    mountMessage('m', '<div data-openui-scope data-openui-part="someone-else">Other</div>');
    expect(componentsToMarkdown(components, createOpenUiTextProjector('m', components))).toBe('Let me check **that**.\n\nHello');
  });

  it('needs no projector when there is no program', () => {
    const components = [textComponent('Just **markdown**')];
    expect(createOpenUiTextProjector('m', components)).toBeUndefined();
    expect(componentsToMarkdown(components)).toBe('Just **markdown**');
  });
});

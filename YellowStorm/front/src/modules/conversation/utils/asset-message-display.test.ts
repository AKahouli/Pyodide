import { describe, expect, it } from 'vitest';
import { assetMessageDisplay } from './asset-message-display';
const ref = (type: string, id = 'document') => btoa(JSON.stringify([type, 'scope', id])).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
describe('historical conversation asset display', () => {
  it('removes only recognized trailing EN/FR selectors and retains readable names and exact refs', () => {
    const document = ref('document'), app = ref('app');
    const result = assetMessageDisplay(`Summarize these [notes].\n\nUse this conversation asset: Budget [Q1].docx [${document}]\nUtiliser ce contenu de la conversation : Tableau des ventes [${app}]\n`);
    expect(result.text).toBe('Summarize these [notes].');
    expect(result.assets).toEqual([{ name: 'Budget [Q1].docx', ref: document }, { name: 'Tableau des ventes', ref: app }]);
  });
  it('supports asset-only requests, duplicate names and reload from stored content', () => {
    const content = `Use this conversation asset: Report.pdf [${ref('document', 'one')}]\nUse this conversation asset: Report.pdf [${ref('artifact', 'two')}]`;
    expect(assetMessageDisplay(content)).toEqual(assetMessageDisplay(JSON.parse(JSON.stringify(content))));
    expect(assetMessageDisplay(content).text).toBe('');
    expect(assetMessageDisplay(content).assets).toHaveLength(2);
  });
  it.each([
    'Ordinary [reference] text',
    'Use this conversation asset: Report.pdf [ordinary]',
    `Use this conversation asset: Report.pdf [${ref('unknown')}]`,
    `Use this conversation asset: Report.pdf [${ref('document')}]\nKeep this ordinary final line`,
    'Utiliser ce contenu de la conversation : malformed []',
  ])('preserves ordinary or malformed text exactly: %s', content => {
    expect(assetMessageDisplay(content)).toEqual({ text: content, assets: [] });
  });
});

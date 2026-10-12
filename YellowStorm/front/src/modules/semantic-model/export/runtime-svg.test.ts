import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildExportView } from './build-view';
import { buildStandaloneGraphHtml } from './standalone-html';
import { colorOf, everyone, format, index, labels, positions, strings, values } from './test-utils';

/** Opens the file in the test page: its markup is copied in and its runtime script is run, as a browser would on load. */
function openFile(withValues: boolean) {
  const view = buildExportView({ index, ids: everyone, labels, colorOf, positions, values: withValues ? values : undefined, format });
  const html = buildStandaloneGraphHtml({
    mode: 'svg', ...view,
    meta: { title: 'Mails', subtitle: 'Exported on 11 Oct 2026', language: 'en', strings: { ...strings, showing: '{{shown}} of {{total}} shown', missingCount: '{{count}} missing', hideConcept: 'Hide {{concept}}' } },
  });
  const page = new DOMParser().parseFromString(html, 'text/html');
  const data = page.getElementById('graph-data')!;
  document.body.replaceChildren(...Array.from(page.body.children).filter((node) => node.tagName !== 'SCRIPT'), data);
  const runtime = [...page.querySelectorAll('script')].filter((script) => !script.id).map((script) => script.textContent).join('\n');
  new Function(runtime)();
}

const nodeGroup = (name: string) => document.querySelector<SVGGElement>(`g.node[aria-label^="${name}"]`)!;
const click = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const button = (name: string | RegExp) => [...document.querySelectorAll('button')].find((item) => (typeof name === 'string' ? item.textContent === name : name.test(item.textContent ?? '')))!;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const search = (text: string) => {
  const input = document.getElementById('search') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  return pause(200);
};

describe('the vector drawing, as opened from the file', () => {
  beforeEach(() => openFile(true));
  afterEach(() => { document.body.replaceChildren(); });

  it('draws every record and link, names the file and counts the concepts', () => {
    expect(document.querySelectorAll('g.node')).toHaveLength(4);
    expect(document.querySelectorAll('line')).toHaveLength(3);
    expect(document.querySelector('h1')!.textContent).toBe('Mails');
    expect(document.getElementById('loading')!.hidden).toBe(true);
    expect(document.getElementById('showing')!.textContent).toBe('4 of 4 shown');
    expect([...document.querySelectorAll('.chip')].map((chip) => chip.textContent)).toEqual(['Message2', 'Correspondent2']);
  });

  it('writes names as text, never as markup', () => {
    expect(document.querySelector('img')).toBeNull();
    expect(nodeGroup('Hello')).not.toBeNull();
    expect(document.body.textContent).toContain('Hello');
  });

  it('selects a record on click and fades what is not next to it, with the panel still closed', () => {
    click(nodeGroup('Invoice'));
    expect(document.getElementById('selection')!.hidden).toBe(false);
    expect(document.querySelector('#selection .name')!.textContent).toBe('Invoice');
    expect(document.getElementById('panel')!.hidden).toBe(true);
    // Invoice is linked to Ana Müller and Zoe, not to the first message.
    expect(nodeGroup('Invoice').getAttribute('opacity')).toBe('1');
    expect(nodeGroup('Zoe').getAttribute('opacity')).toBe('1');
    expect(nodeGroup('Hello').getAttribute('opacity')).toBe('0.3');
    click(document.querySelector('svg')!);
    expect(document.getElementById('selection')!.hidden).toBe(true);
    expect(nodeGroup('Hello').getAttribute('opacity')).toBe('1');
  });

  it('opens the details of the selected record: values, missing fields and linked records', () => {
    click(nodeGroup('Invoice'));
    click(button('details'));
    const panel = document.getElementById('panel')!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('h2')!.textContent).toBe('Invoice');
    expect(panel.textContent).toContain('<Invoice 42>');
    expect(panel.textContent).toContain('<Please pay>');
    expect(panel.textContent).toContain('Ana Müller');
    click(panel.querySelector<HTMLButtonElement>('button[aria-label="close"]')!);
    expect(panel.hidden).toBe(true);
  });

  it('lists the fields a record misses, with its values left out when the file holds none', () => {
    click(nodeGroup('Hello'));
    click(button('details'));
    const panel = document.getElementById('panel')!;
    expect(panel.textContent).toContain('1 missing');
    click(panel.querySelector('.missing-toggle')!);
    expect(panel.querySelector('dd.missing')!.textContent).toBe('missingValue');
  });

  it('finds records by name, ignoring case and accents, lights them up and goes to the first on Enter', async () => {
    await search('muller');
    const results = document.querySelectorAll('#results li');
    expect(results).toHaveLength(1);
    expect(results[0].textContent).toContain('Ana Müller');
    expect(nodeGroup('Ana').getAttribute('opacity')).toBe('1');
    expect(nodeGroup('Zoe').getAttribute('opacity')).toBe('0.15');

    (document.getElementById('search') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.querySelector('#selection .name')!.textContent).toBe('Ana Müller');
    expect((document.getElementById('search') as HTMLInputElement).value).toBe('');
    // The search no longer singles records out; the selection fades what is not next to Ana.
    expect(nodeGroup('Hello').getAttribute('opacity')).toBe('1');
    expect(nodeGroup('Zoe').getAttribute('opacity')).toBe('0.3');
  });

  it('finds records by id and by value, and says when nothing matches', async () => {
    await search('m2');
    expect(document.querySelector('#results')!.textContent).toContain('Invoice');
    await search('please pay');
    expect(document.querySelector('#results')!.textContent).toContain('Body: <Please pay>');
    await search('zzz');
    expect(document.querySelector('#results .empty')!.textContent).toBe('noMatch');
  });

  it('hides and shows the records of a concept from the legend', () => {
    click(button(/^Correspondent/));
    expect(nodeGroup('Ana').getAttribute('display')).toBe('none');
    expect(nodeGroup('Invoice').getAttribute('display')).toBe('inline');
    expect(document.getElementById('showing')!.textContent).toBe('2 of 4 shown');
    click(button('showAll'));
    expect(nodeGroup('Ana').getAttribute('display')).toBe('inline');
  });

  it('opens a record that was hidden when it is reached from a search', async () => {
    click(button(/^Correspondent/));
    await search('zoe');
    (document.getElementById('search') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(nodeGroup('Zoe').getAttribute('display')).toBe('inline');
    expect(document.querySelector('#selection .name')!.textContent).toBe('Zoe');
  });
});

describe('the file without values', () => {
  beforeEach(() => openFile(false));
  afterEach(() => { document.body.replaceChildren(); });

  it('says so in the panel and lists the fields', () => {
    click(nodeGroup('Invoice'));
    click(button('details'));
    const panel = document.getElementById('panel')!;
    expect(panel.textContent).toContain('valuesNotIncluded');
    expect(panel.textContent).toContain('Subject');
  });
});

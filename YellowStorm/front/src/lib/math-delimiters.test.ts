import { describe, expect, it } from 'vitest';
import { normalizeMathDelimiters } from './math-delimiters';

describe('normalizeMathDelimiters', () => {
  it('leaves content without LaTeX delimiters untouched', () => {
    const markdown = 'Prix: 10$ et **gras** avec `code`.';
    expect(normalizeMathDelimiters(markdown)).toBe(markdown);
  });

  it('converts display math on its own lines to $$ blocks', () => {
    const markdown = 'La logique :\n\\[\n\\sum_{i=1}^{n} x_i \\times y_i\n\\]\nFin.';
    expect(normalizeMathDelimiters(markdown)).toBe(
      'La logique :\n$$\n\\sum_{i=1}^{n} x_i \\times y_i\n$$\nFin.',
    );
  });

  it('converts single-line display math', () => {
    expect(normalizeMathDelimiters('valeur \\[ E = mc^2 \\] fin')).toBe('valeur $$\nE = mc^2\n$$ fin');
  });

  it('converts inline math and trims the inner content', () => {
    expect(normalizeMathDelimiters('le taux \\( t_i \\) projeté')).toBe('le taux $t_i$ projeté');
  });

  it('leaves empty delimiters verbatim', () => {
    expect(normalizeMathDelimiters('vide \\[\\] et \\(\\) ici')).toBe('vide \\[\\] et \\(\\) ici');
  });

  it('leaves unclosed delimiters verbatim while converting later complete ones', () => {
    expect(normalizeMathDelimiters('partiel \\[ E =\nsuite \\( x \\)')).toBe('partiel \\[ E =\nsuite $x$');
  });

  it('leaves $$ and $ math already in remark-math form untouched', () => {
    expect(normalizeMathDelimiters('$$\na + b\n$$')).toBe('$$\na + b\n$$');
  });

  it('does not convert inside fenced code blocks', () => {
    const markdown = '```latex\n\\[ E = mc^2 \\]\n\\( x \\)\n```\n\\[ y \\]';
    expect(normalizeMathDelimiters(markdown)).toBe('```latex\n\\[ E = mc^2 \\]\n\\( x \\)\n```\n$$\ny\n$$');
  });

  it('does not convert inside a closing-fence candidate until the fence closes', () => {
    const markdown = '~~~\n\\[ x \\]\n\\[ y \\]\n~~~\n\\( z \\)';
    expect(normalizeMathDelimiters(markdown)).toBe('~~~\n\\[ x \\]\n\\[ y \\]\n~~~\n$z$');
  });

  it('does not convert inside inline code spans', () => {
    const markdown = 'voir `\\[ x \\]` puis \\[ y \\]';
    expect(normalizeMathDelimiters(markdown)).toBe('voir `\\[ x \\]` puis $$\ny\n$$');
  });

  it('keeps converting after a stray unclosed backtick', () => {
    expect(normalizeMathDelimiters('un ` retour \\[ x \\]')).toBe('un ` retour $$\nx\n$$');
  });
});

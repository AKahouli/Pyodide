import { describe, expect, it } from 'vitest';
import { parseComposerSuggestionsContent } from './parseComposerSuggestions';

describe('parseComposerSuggestionsContent', () => {
  const legacyValid = {
    suggestions: [
      'Pourrais-tu préciser le contexte technique ?',
      'Peux-tu décrire le comportement attendu ?',
      'Quelle version du logiciel utilises-tu ?',
      'Ajoute un exemple de code si possible',
    ],
  };

  const structuredSample = `✅ Version corrigée
Bonjour, pouvez-vous m'aider sur ce bug ?

✨ Suggestions similaires :
Bonjour, pourriez-vous m'aider avec ce bug ?
Salut, tu peux m'aider sur ce bug ?
Bonjour, j'ai un bug, pouvez-vous m'aider ?`;

  it('parses structured ✅ / ✨ response', () => {
    const out = parseComposerSuggestionsContent(structuredSample);
    expect(out).toBe("Bonjour, pourriez-vous m'aider avec ce bug ?");
  });

  it('parses structured without ✅ emoji on version line', () => {
    const text = `Version corrigée
Phrase corrigée ici

✨ Suggestions similaires :
Alt un
Alt deux
Alt trois`;
    const out = parseComposerSuggestionsContent(text);
    expect(out).toBe('Alt un');
  });

  it('skips placeholder lines like Suggestion 1', () => {
    const text = `✅ Version corrigée
OK

✨ Suggestions similaires :
Suggestion 1
Real phrase one
Real phrase two
Real phrase three`;
    const out = parseComposerSuggestionsContent(text);
    expect(out).toBe('Real phrase one');
  });

  it('parses plain JSON (legacy)', () => {
    expect(parseComposerSuggestionsContent(JSON.stringify(legacyValid))).toBe(legacyValid.suggestions[0]);
  });

  it('parses fenced json', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(legacyValid)}\n\`\`\``;
    expect(parseComposerSuggestionsContent(fenced)).toBe(legacyValid.suggestions[0]);
  });

  it('parses fenced without language tag', () => {
    const fenced = `\`\`\`\n${JSON.stringify(legacyValid)}\n\`\`\``;
    expect(parseComposerSuggestionsContent(fenced)).toBe(legacyValid.suggestions[0]);
  });

  it('returns null for invalid JSON when not structured', () => {
    expect(parseComposerSuggestionsContent('not json')).toBe('not json');
  });

  it('returns null for wrong legacy array length', () => {
    expect(
      parseComposerSuggestionsContent(JSON.stringify({ suggestions: legacyValid.suggestions.slice(0, 3) })),
    ).toBe(legacyValid.suggestions[0]);
  });

  it('returns null for empty string in legacy suggestions', () => {
    expect(
      parseComposerSuggestionsContent(
        JSON.stringify({ suggestions: [...legacyValid.suggestions.slice(0, 3), '  '] }),
      ),
    ).toBe(legacyValid.suggestions[0]);
  });

  it('trims legacy suggestion strings', () => {
    const spaced = {
      suggestions: legacyValid.suggestions.map((s) => `  ${s}  `),
    };
    expect(parseComposerSuggestionsContent(JSON.stringify(spaced))).toBe(legacyValid.suggestions[0]);
  });
});

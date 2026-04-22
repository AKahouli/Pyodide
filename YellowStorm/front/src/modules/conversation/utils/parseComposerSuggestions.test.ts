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
    expect(out).toEqual([
      "Bonjour, pouvez-vous m'aider sur ce bug ?",
      'Bonjour, pourriez-vous m'aider avec ce bug ?',
      'Salut, tu peux m'aider sur ce bug ?',
      "Bonjour, j'ai un bug, pouvez-vous m'aider ?",
    ]);
  });

  it('parses structured without ✅ emoji on version line', () => {
    const text = `Version corrigée
Phrase corrigée ici

✨ Suggestions similaires :
Alt un
Alt deux
Alt trois`;
    const out = parseComposerSuggestionsContent(text);
    expect(out).toEqual(['Phrase corrigée ici', 'Alt un', 'Alt deux', 'Alt trois']);
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
    expect(out).toEqual(['OK', 'Real phrase one', 'Real phrase two', 'Real phrase three']);
  });

  it('parses plain JSON (legacy)', () => {
    expect(parseComposerSuggestionsContent(JSON.stringify(legacyValid))).toEqual(legacyValid.suggestions);
  });

  it('parses fenced json', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(legacyValid)}\n\`\`\``;
    expect(parseComposerSuggestionsContent(fenced)).toEqual(legacyValid.suggestions);
  });

  it('parses fenced without language tag', () => {
    const fenced = `\`\`\`\n${JSON.stringify(legacyValid)}\n\`\`\``;
    expect(parseComposerSuggestionsContent(fenced)).toEqual(legacyValid.suggestions);
  });

  it('returns null for invalid JSON when not structured', () => {
    expect(parseComposerSuggestionsContent('not json')).toBeNull();
  });

  it('returns null for wrong legacy array length', () => {
    expect(
      parseComposerSuggestionsContent(JSON.stringify({ suggestions: legacyValid.suggestions.slice(0, 3) })),
    ).toBeNull();
  });

  it('returns null for empty string in legacy suggestions', () => {
    expect(
      parseComposerSuggestionsContent(
        JSON.stringify({ suggestions: [...legacyValid.suggestions.slice(0, 3), '  '] }),
      ),
    ).toBeNull();
  });

  it('trims legacy suggestion strings', () => {
    const spaced = {
      suggestions: legacyValid.suggestions.map((s) => `  ${s}  `),
    };
    expect(parseComposerSuggestionsContent(JSON.stringify(spaced))).toEqual(legacyValid.suggestions);
  });
});

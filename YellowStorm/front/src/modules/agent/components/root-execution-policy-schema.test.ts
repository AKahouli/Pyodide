import { describe, expect, it } from 'vitest';
import { isRootAgentType, isDelegateAgentType } from './root-execution-policy-schema';

describe('ROOT type compatibility', () => {
  it.each(['mono-agent', 'mono_agent', 'Mono_Agent', 'mono agent'])('recognizes %s', (slug) => {
    expect(isRootAgentType(slug)).toBe(true);
    expect(isDelegateAgentType(slug)).toBe(false);
  });
  it.each(['humain', 'platform-copilot', 'Platform_Copilot'])('excludes %s from delegation', (slug) => {
    expect(isRootAgentType(slug)).toBe(false);
    expect(isDelegateAgentType(slug)).toBe(false);
  });
  it('keeps ordinary specialists eligible', () => {
    expect(isRootAgentType('search')).toBe(false);
    expect(isDelegateAgentType('search')).toBe(true);
  });
});

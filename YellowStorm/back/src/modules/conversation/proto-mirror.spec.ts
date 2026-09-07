import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guardrail: the Nest backend and the Python ADK must run the same
 * chatbot.proto wire contract. The ADK tree is not always present (CI
 * checkouts without the sibling repository), so the assertion is skipped
 * there instead of failing.
 */
describe('chatbot.proto mirror parity', () => {
  it('backend and ADK proto files are byte-identical', () => {
    const backendProto = resolve(process.cwd(), 'src/modules/conversation/proto/chatbot.proto');
    const adkProto = resolve(process.cwd(), '..', 'yellowstorm-adk/grpc/proto/chatbot.proto');

    let adkContent: string;
    try {
      adkContent = readFileSync(adkProto, 'utf8');
    } catch {
      // ADK repository not checked out next to the backend — nothing to compare.
      return;
    }

    expect(adkContent).toBe(readFileSync(backendProto, 'utf8'));
  });
});

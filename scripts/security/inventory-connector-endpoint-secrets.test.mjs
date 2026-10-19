import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeRecord } from './inventory-connector-endpoint-secrets.mjs';

test('R03 inventory emits IDs, field names, parameter names and counts, never values', () => {
  const canary = 'TEST_CANARY_R03';
  const row = { id: 'synthetic-connector', mcp_server_url: `https://mcp.example.test/mcp?token=${canary}`,
    description: `Copied ${canary}`, actions: [{ description: `https://mcp.example.test/mcp?sig=${canary}` }] };
  const report = summarizeRecord('connector', row);
  assert.equal(report.length, 3);
  assert.deepEqual(report[0].queryParameterNames, ['token']);
  assert.deepEqual(report[2].queryParameterNames, ['sig']);
  assert.equal(report[1].copiedValueCount, 1);
  assert.ok(!JSON.stringify(report).includes(canary));
  assert.ok(!JSON.stringify(report).includes('https://'));
  assert.equal(row.description, `Copied ${canary}`);
});

test('R03 inventory scans nested historical audit metadata without returning content', () => {
  const report = summarizeRecord('audit', { id: 'synthetic-audit', metadata: {
    nested: [{ serverUrl: 'https://user:TEST_CANARY_R03@mcp.example.test/mcp?%74oken=TEST_CANARY_R03' }],
  } });
  assert.equal(report[0].userinfoUrlCount, 1);
  assert.deepEqual(report[0].queryParameterNames, ['token']);
  assert.ok(!JSON.stringify(report).includes('TEST_CANARY_R03'));
});

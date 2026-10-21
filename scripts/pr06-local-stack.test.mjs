import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquireRedis } from './pr06-local-stack.mjs';

test('cancellation during image inspection prevents later Redis creation', async () => {
  let cancelled = false;
  const calls = [];
  await assert.rejects(acquireRedis(async (_exe, args) => {
    calls.push(args[0]); cancelled = true; return {};
  }, { image: 'existing', create: ['create'] }, () => cancelled, () => assert.fail('unexpected resource')), /supervisor_stopping/);
  assert.deepEqual(calls, ['image']);
});
test('cancellation racing create retains ownership for shutdown cleanup', async () => {
  let cancelled = false, owned;
  const id = 'a'.repeat(64);
  const pending = acquireRedis(async (_exe, args) => {
    if (args[0] === 'create') { cancelled = true; return { stdout: id }; }
    return {};
  }, { image: 'existing', create: ['create'] }, () => cancelled, acquired => { owned = acquired; });
  await pending;
  assert.equal(cancelled, true);
  assert.equal(owned, id);
});

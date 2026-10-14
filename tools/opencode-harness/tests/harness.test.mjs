import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { openHarness } from '../runtime/lib/sdlc-core.mjs';
import { fixture } from './fixture.mjs';
const start = (h, id) => h.checkpoint(id, { goal: `Task ${id}`, acceptance: ['Continue work'], nextAction: 'Continue', status: 'active' });
test('resume preserves active source and destination histories as independent continuations', async () => {
  const f=fixture();const h=await openHarness(f.root);
  try {
    start(h,'source');start(h,'destination');
    const resumed=h.resume('destination','source');
    assert.notEqual(resumed.id,'source');assert.notEqual(resumed.id,'destination');
    assert.equal(resumed.goal,'Task source');assert.equal(resumed.recovery.resumedFrom,'source');
    assert.equal(h.state('source').id,'source');
    h.checkpoint('source',{nextAction:'Original continues'});
    assert.equal(h.state('destination').nextAction,'Continue');
    h.checkpoint('destination',{status:'cancelled'});
    assert.equal(h.resume('destination','source').goal,'Task source');
    assert.equal(h.prepare,undefined);assert.equal(h.release,undefined);assert.equal(h.beforeEdit,undefined);
  } finally {h.close();f.cleanup();}
});
test('resume does not guess and invalidates checks when their inputs change', async () => {
 const f=fixture();const h=await openHarness(f.root);
 try {
  start(h,'a');start(h,'b');
  assert.equal(h.autoResume('fresh','Build another feature'),null);
  assert.equal(h.autoResume('fresh','resume').resumeCandidates.length,2);
  h.checkpoint('a',{checks:[{name:'Relevant check',status:'PASS',files:['src/a.js']}]});
  writeFileSync(f.root+'/src/a.js','export const changed = 2;');
  assert.equal(h.resume('fresh','a').checks[0].status,'HISTORICAL');
 } finally {h.close();f.cleanup();}
});
test('parallel processes preserve independent checkpoint progress without file locks',async()=>{
 const f=fixture();let h;
 try {
  const children=['a','b'].map(id=>fork(new URL('./process-worker.mjs',import.meta.url),[f.root,id],{stdio:['ignore','ignore','pipe','ipc'],execArgv:[],windowsHide:true}));
  assert.ok((await Promise.all(children.map(c=>once(c,'exit')))).every(([code])=>code===0));
  h=await openHarness(f.root);assert.deepEqual(h.state('a').completed,['step-39']);assert.deepEqual(h.state('b').completed,['step-39']);
 }finally{h?.close();f.cleanup();}
});

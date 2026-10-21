import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedRequest,validPaint,guardedBrowserLaunch} from './benchmark-classic-conversation-sse-browser-matrix.mjs';
import {finalizeBrowserReport} from './benchmark-classic-conversation-sse-browser.mjs';

test('browser workload cannot reach live or non-isolated API origins',()=>{
 assert.equal(allowedRequest('http://localhost:3301/api/v1/conversations','POST'),true);
 assert.equal(allowedRequest('http://localhost:3302/api/v1/auth/refresh','POST'),true);
 assert.equal(allowedRequest('http://localhost:5173/src/main.tsx','GET'),true);
 for(const url of ['http://localhost:3000/api/v1/auth/login','http://localhost:8001/health/ready','http://example.com/api/v1/conversations','http://localhost:3301/not-api','http://name:secret@localhost:3301/api/v1/conversations']){
  assert.equal(allowedRequest(url,'GET'),false);
 }
 assert.equal(allowedRequest('http://localhost:5173/api/v1/conversations','POST'),false);
});
test('browser paint evidence rejects incomplete, skewed and invalid timing values',()=>{
 const payload={schemaVersion:1,quality:'ok',frontendFirstChunkPaintedEpochMs:10,frontendRenderMs:2,browserRenderOnlyMs:1};
 assert.equal(validPaint(payload),true);
 assert.equal(validPaint({...payload,quality:'clock-skew'}),false);
 assert.equal(validPaint({...payload,browserRenderOnlyMs:NaN}),false);
 assert.equal(validPaint({...payload,frontendRenderMs:-1}),false);
 assert.equal(validPaint({...payload,schemaVersion:2}),false);
});
test('memory cancellation during asynchronous preparation prevents a late browser acquisition',async()=>{
 let cancelled=false,launches=0,resume;
 const preparation=new Promise(resolve=>{resume=resolve;});
 const work=(async()=>{
  await preparation;
  return guardedBrowserLaunch(()=>{if(cancelled)throw new Error('host_memory_budget_stop');},()=>{launches++;return {};});
 })();
 cancelled=true;
 const finalized=finalizeBrowserReport({smokePass:false,code:'host_memory_budget_stop',cleanup:{browserClosed:true}},false);
 resume();
 await assert.rejects(work,/host_memory_budget_stop/);
 assert.equal(launches,0);
 assert.equal(finalized.cleanup.browserClosed,true);
 assert.equal(finalized.smokePass,false);
});

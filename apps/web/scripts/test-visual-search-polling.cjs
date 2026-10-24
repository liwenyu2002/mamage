const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const filename = path.join(__dirname,'../src/services/visualSearchPolling.js');
const loaded = new Module(filename,module);
loaded.filename = filename;
loaded._compile(babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,
  presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,filename);
const {watchVisualSearch} = loaded.exports;
const snapshot = (ids,pending) => ({list:ids.map(id=>({id})),total:ids.length,search:{visual:{pending,retryAfterMs:1000}}});

test('confirmed results refresh without exposing unknowns or clearing the page between batches',async()=>{
  const events=[]; let calls=0;
  const result = await watchVisualSearch(async progress=>{
    calls++;
    const response = calls===1 ? snapshot([1],1) : snapshot([1,2],0);
    progress?.({type:'results',data:response}); return response;
  },{onProgress:event=>events.push(event),wait:async()=>{},maxWaitMs:5000});
  assert.equal(calls,2);
  assert.deepEqual(result.list.map(photo=>photo.id),[1,2]);
  assert.deepEqual(events.filter(event=>event.type==='results').map(event=>event.data.list.length),[1,2]);
});

test('changing search cancels polling and a bounded wait leaves backend work intact',async()=>{
  const controller = new AbortController(); let calls=0;
  await assert.rejects(watchVisualSearch(async()=>{calls++;return snapshot([],1);},
    {signal:controller.signal,onProgress:()=>{},wait:async()=>controller.abort()}),{name:'AbortError'});
  assert.equal(calls,1);
  let clock=0;
  const pending = await watchVisualSearch(async()=>snapshot([],1),{onProgress:()=>{},now:()=>clock,
    wait:async()=>{clock+=1000;},maxWaitMs:1000});
  assert.equal(pending.search.visual.watchPaused,true);
  const complete = await watchVisualSearch(async()=>snapshot([1],0),{onProgress:()=>{}});
  assert.equal(complete.search.visual.watchPaused,undefined);
});

test('temporary refresh failures retry, but revoked authorization stops immediately',async()=>{
  let calls=0;
  const result=await watchVisualSearch(async()=>{
    calls++;if(calls===2)throw Error('temporary');return snapshot([1],calls<3?1:0);
  },{onProgress:()=>{},wait:async()=>{}});
  assert.equal(calls,3);assert.equal(result.search.visual.pending,0);
  calls=0;
  await assert.rejects(watchVisualSearch(async()=>{
    if(++calls>1)throw Object.assign(Error('revoked'),{status:403});return snapshot([1],1);
  },{onProgress:()=>{},wait:async()=>{}}),{status:403});
  assert.equal(calls,2);
});

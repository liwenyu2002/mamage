const assert = require('node:assert/strict');
const {test} = require('node:test');
const {Readable} = require('node:stream');
const {evidenceKey} = require('../lib/person_visual_evidence');
const mock = (name,exports) => {const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
process.env.SEARCH_VISUAL_ENABLED='1';
const face={id:12,photoId:101,personId:343,x:0.1,y:0.1,w:0.1,h:0.1,thumbUrl:'/uploads/t.jpg'};
let loads=0; let changed=false; let handler; let infer=async()=>new Map([[12,{binding:'clear',visibility:'clear',colors:['green']}] ]);
let writes=[];
mock('../lib/distributed_runtime',{distributed:()=>false,coordinator:{register:(kind,lane,fn)=>{
  assert.equal(kind,'person-visual');assert.equal(lane,'vision');handler=fn;
}}});
mock('../lib/search_visual_index',{
  loadFaces:async()=>{loads++;return changed&&loads>1 ? [{...face,personId:44}] : [face];},
  readEvidence:async()=>new Map(),writeEvidence:async(row,value)=>writes.push({row,value}),
});
mock('../lib/person_visual_inference',{analyzePeople:(...args)=>infer(...args)});
mock('../lib/cos_storage',{keyFromUrlOrPath:()=> 'uploads/t.jpg',isConfigured:()=>true,isSafeKey:()=>true,
  getObject:async()=>({ContentLength:4,Body:Readable.from([Buffer.from('test')])})});
const worker=require('../lib/search_visual_worker');
const job=()=>({photoId:101,personId:343,keys:[evidenceKey(face)],assertions:[]});

test('durable handler validates current source before and after inference, without editing photo or face records',async()=>{
  await handler(job());
  assert.equal(writes.length,1);
  assert.equal(writes[0].value.state,'done');
  assert.deepEqual(writes[0].value.colors,['green']);
  loads=0;writes=[];changed=true;
  await worker.processJob(job());
  assert.equal(writes.length,0,'face reassignment during inference invalidates its evidence');
  changed=false;
});

test('inference failure is stored as failed/unknown, never a negative garment decision',async()=>{
  loads=0;writes=[];infer=async()=>{throw Error('private provider text');};
  await assert.rejects(worker.processJob(job()),/PERSON_VISUAL_ANALYSIS_FAILED/);
  assert.equal(writes.length,1);
  assert.equal(writes[0].value.state,'failed');
  assert.equal(writes[0].value.binding,'uncertain');
  assert.deepEqual(writes[0].value.colors,[]);
  assert.ok(!JSON.stringify(writes).includes('private provider'));
});

test('shutdown cancels an active model request and stops accepting more work',async()=>{
  let started;
  const ready=new Promise(resolve=>started=resolve);
  infer=(_buffer,_faces,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});started();
  });
  const active=worker.processJob(job());
  const failed=assert.rejects(active,/PERSON_VISUAL_ANALYSIS_FAILED/);
  await ready; await worker.stop(); await failed;
  assert.equal(await worker.enqueue([face]),false);
});

const assert = require('node:assert/strict');
const mock = (name,exports)=>{const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
const locks=new Map(), jobs=new Map([[1,{id:1,status:'running',prompt_text:'test',options:{},user_id:7}]]), results=[];
let modelCalls=0, allowModel, scanCalls=0, allowScan, resets=0;
let contestedItem = false, itemReads = 0, itemClaims = 0;
const imported={id:3,project_id:9,organization_id:2,unit_id:1,provider:'photoplus',status:'queued',scan_status:'pending',source_url:'https://example.test/album'};
async function query(sql,p=[]) {
  if(sql.startsWith('SELECT * FROM ai_jobs'))return [[structuredClone(jobs.get(p[0]))].filter(Boolean)];
  if(sql.startsWith('SELECT id FROM ai_jobs'))return [[...jobs.values()].filter(j=>['pending','running'].includes(j.status)).map(j=>({id:j.id}))];
  if(sql.startsWith('SELECT * FROM ai_results'))return [results.filter(r=>r.job_id===p[0])];
  if(sql.startsWith('UPDATE ai_jobs')){jobs.get(p.at(-1)).status=p[0];return [{affectedRows:1}];}
  if(sql.startsWith('INSERT INTO ai_results')){results.push({job_id:p[0],title:p[1],placeholders:p[5]});return [{insertId:results.length}];}
  if(sql.startsWith('SELECT organization_id FROM users'))return [[{organization_id:2}]];
  if(sql.startsWith('SELECT * FROM external_import_jobs'))return [['queued','running'].includes(imported.status)?[{...imported}]:[]];
  if(sql.startsWith('SELECT status FROM external_import_jobs'))return [[{status:imported.status}]];
  if(sql.startsWith('SELECT organization_id, unit_id FROM projects'))return [[{organization_id:2,unit_id:1}]];
  if(sql.startsWith('SELECT status, cancel_requested, scan_status'))return [[{status:imported.status,cancel_requested:0,scan_status:imported.scan_status}]];
  if(sql.startsWith('SELECT * FROM external_import_items'))return [contestedItem && itemReads++ === 0 ? [{id:10,status:'pending'}] : []];
  if(sql.startsWith('SELECT SUM(status'))return [[{pending:0,failed:0}]];
  if(sql.includes("UPDATE external_import_items SET status = 'running'")){itemClaims++;return [{affectedRows:0}];}
  if(sql.startsWith('UPDATE external_import_items')){resets++;return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE external_import_jobs SET status = 'queued', scan_status")){
    imported.status='queued';if(imported.scan_status==='running')imported.scan_status='pending';return [{affectedRows:1}];
  }
  if(sql.includes("SET scan_status = 'running'")){imported.scan_status='running';return [{affectedRows:1}];}
  if(sql.includes("SET scan_status = 'completed'")){imported.scan_status='completed';return [{affectedRows:1}];}
  if(sql.includes("SET status = 'running', scan_error_code")){
    if(imported.status!=='queued')return [{affectedRows:0}];imported.status='running';return [{affectedRows:1}];
  }
  if(sql.startsWith('UPDATE external_import_jobs SET status = ?')){imported.status=p[0];return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE external_import_jobs SET status = 'queued', retry_after"))return [{affectedRows:0}];
  throw new Error(`Unexpected SQL ${sql}`);
}
const pool={query,async getConnection(){
  const owner={};
  return {query:async(sql,p)=>{
    if(sql.includes('GET_LOCK')){if(locks.has(p[0]))return [[{acquired:0}]];locks.set(p[0],owner);return [[{acquired:1}]];}
    if(sql.includes('IS_USED_LOCK'))return [[{owned:Number(locks.get(p[0])===owner)}]];
    if(sql.includes('RELEASE_LOCK')){if(locks.get(p[0])===owner)locks.delete(p[0]);return [[{}]];}
    return query(sql,p);
  },async beginTransaction(){},async commit(){},async rollback(){},release(){}};
}};
mock('../db',{pool});
mock('../ai_function/ai_for_news/ai_for_news',{generateFromPrompt:async()=>{
  modelCalls++;await new Promise(resolve=>{allowModel=resolve;});return {title:'Recovered',markdown:'News',placeholders:[],tokens:0};
}});
mock('../lib/channel_templates',{getTemplateByKey:async()=>null});
mock('../lib/ai_quota',{acquire:async()=>{},release:()=>{},recordTokens:async()=>{}});
const worker=require('../lib/ai_job_worker');
const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('Test condition timed out');};
(async()=>{
  const first=worker.processJob(1);
  await until(()=>modelCalls===1);
  assert.equal(await worker.processJob(1),null,'second process must not reclaim a live news job');
  allowModel();await first;
  assert.equal(jobs.get(1).status,'succeeded');assert.equal(results.length,1);
  jobs.get(1).status='running';
  await worker.processJob(1);
  assert.equal(jobs.get(1).status,'succeeded');assert.equal(modelCalls,1,'recover stored results without paying twice');
  jobs.set(2,{...jobs.get(1),id:2,status:'pending'});
  await worker.pump();await until(()=>modelCalls===2);allowModel();await until(()=>jobs.get(2).status==='succeeded');
  await until(()=>locks.size===0);
  mock('../routes/upload',{});mock('../lib/cos_storage',{});
  mock('../lib/external_import_jobs',{updateImportMetadata:async()=>{},ingestBatch:async()=>{}});
  mock('../lib/external_gallery_alltuu',{parseAlltuuUrl:()=>null});mock('../lib/external_gallery_templates',{});
  mock('../lib/external_gallery_scan',{scanPhotoPlus:async()=>{
    scanCalls++;await new Promise(resolve=>{allowScan=resolve;});return {title:'Album',quality:'original',reportedTotal:0};
  }});
  const a=require('../lib/external_import_worker');a.start();await until(()=>scanCalls===1);
  delete require.cache[require.resolve('../lib/external_import_worker')];
  const b=require('../lib/external_import_worker');b.start();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(scanCalls,1,'second worker must not steal a live import');assert.equal(resets,0);
  allowScan();await until(()=>imported.status==='completed');await until(()=>locks.size===0);
  imported.id=4;imported.status='running';imported.scan_status='running';
  a.wake();await until(()=>scanCalls===2);
  assert.equal(resets,1,'only orphaned import items should be reset');
  allowScan();await until(()=>imported.status==='completed');await until(()=>locks.size===0);
  imported.id=5;imported.status='queued';imported.scan_status='completed';contestedItem=true;
  a.wake();await until(()=>imported.status==='completed');await until(()=>locks.size===0);
  assert.equal(itemClaims,1,'a lost item claim must be skipped before transferring media');
  console.log('PASS: orphan news/import recovery, result reuse, durable polling, overlapping workers and item claims');
})().catch(error=>{console.error(error);process.exitCode=1;});

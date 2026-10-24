const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test'),{createRequire}=require('node:module'),express=require('express');
function load(file,deps){const module={exports:{}},actual=createRequire(file);vm.runInNewContext(fs.readFileSync(file,'utf8'),{
  module,exports:module.exports,process,console,Buffer,require:key=>Object.hasOwn(deps,key)?deps[key]:actual(key),
},{filename:file});return module.exports;}
class AccessError extends Error{constructor(message,status=403){super(message);this.status=status;}}
function fixture({search=true,manage=false,enabled=true,collegeAdmin=false}={}){
 const workspace={userId:7,orgId:2,unitId:1,userRole:'admin',role:'editor',enabled,collegeAdmin};
 const writes=[],queries=[],roles=new Map([[20,'editor'],[21,'manager']]);let grant=search?{college_wide:1,can_manage:manage?1:0}:null;
 const db={query:async(sql,params)=>{
  queries.push(sql);
  if(sql.includes('SELECT college_wide, can_manage'))return [grant?[grant]:[]];
  if(sql.includes('SELECT m.role FROM organization_units'))return [params[1]===1?[{role:workspace.role}]:[]];
  if(sql.includes('SELECT role FROM organization_unit_memberships'))return [roles.has(params[1])?[{role:roles.get(params[1])}]:[]];
  if(sql.includes('organization_access_audit'))return [{}];
  if(sql.includes('SELECT COUNT(*) AS total'))return [[{total:0}]];
  if(sql.includes('FROM face_persons fp'))return [[]];
  if(sql.includes('SELECT g.user_id'))return [grant?[{userId:20,collegeWide:grant.college_wide,canManage:grant.can_manage}]:[]];
  if(sql.includes('SELECT id FROM users'))return [roles.has(params[0])?[{id:params[0]}]:[]];
  if(sql.includes('INSERT INTO organization_unit_memberships')){writes.push(sql);roles.set(params[1],params[2]);return [{}];}
  if(sql.includes('UPDATE organization_unit_memberships')){writes.push(sql);roles.delete(params[1]);return [{}];}
  if(sql.includes('UPDATE users SET active_unit_id'))return [{}];
  if(sql.startsWith('INSERT INTO face_search_grants')){writes.push(sql);grant={college_wide:1,can_manage:params[2]};return [{}];}
  if(sql.startsWith('DELETE FROM face_search_grants')){writes.push(sql);grant=null;return [{}];}
  throw Error('Unexpected query '+sql);
 }};
 db.getConnection=async()=>({...db,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}});
 const access={resolveWorkspace:async()=>workspace,WorkspaceAccessError:AccessError,
  requirePhotoAccess:async()=>({}),requireProjectAccess:async()=>({}),positiveId:value=>Number(value)>0?Number(value):null,
  sendWorkspaceError:(res,error)=>{if(!error.status)return false;res.status(error.status).json({error:error.message});return true;}};
 const face=load(require.resolve('../lib/face_access'),{'../db':{pool:db},'./workspace_access':access});
 const dependencies={'../db':{pool:db},'../lib/workspace_access':access,'../lib/face_access':face,
  '../lib/permissions':{requirePermission:()=> (_req,_res,next)=>next()},
  '../lib/face_detector':{},'../lib/face_avatar':{},'../lib/face_feedback':{},'../lib/media_access':{buildMediaUrl:value=>value}};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:7,role:'admin',organization_id:2};next();});
 app.use('/api',load(require.resolve('../routes/faces'),dependencies));
 app.use('/api/workspaces',load(require.resolve('../routes/workspaces'),dependencies));
 return{app,writes,queries,grant:()=>grant,workspace,roles};
}
async function serve(f,fn){const server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{await fn(async(path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{'Content-Type':'application/json'},...(body&&method!=='GET'?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};});}
 finally{await new Promise(r=>server.close(r));}}

test('search-only users can read people but every mutation is rejected before business SQL',async()=>{
 const f=fixture();await serve(f,async call=>{
  assert.equal((await call('/api/persons')).status,200);
  for(const [path,method]of [['/api/persons/merge','POST'],['/api/persons/1','PATCH'],
   ['/api/persons/1/split-preview','POST'],['/api/persons/1/split','POST'],['/api/faces/label','POST'],
   ['/api/photos/1/faces/detect','POST'],['/api/photos/1/faces?detect=1','GET']]){
   const response=await call(path,method,{personName:'Forbidden'});
   assert.equal(response.status,403,path);assert.equal(response.body.error,'FACE_MANAGEMENT_GRANT_REQUIRED');
  }
 });assert.equal(f.writes.length,0);
});
test('grant-required reads apply to legacy spaces too, even when the old account role is admin',async()=>{
 for(const enabled of [true,false]){
  const f=fixture({enabled,search:false});await serve(f,async call=>{
   const r=await call('/api/persons');assert.equal(r.status,403);assert.equal(r.body.error,'FACE_SEARCH_GRANT_REQUIRED');
  });assert.equal(f.writes.length,0);
 }
});
test('explicit maintenance retains access to mutation validation, never bypassing validation',async()=>{
 const f=fixture({manage:true});await serve(f,async call=>{assert.equal((await call('/api/persons/merge','POST',{})).status,400);});
});
test('new grants default to search-only; maintenance needs an explicit boolean and remains independent',async()=>{
 const f=fixture({collegeAdmin:true,search:false});await serve(f,async call=>{
  assert.equal((await call('/api/workspaces/face-search/20','PUT',{})).status,200);assert.equal(f.grant().can_manage,0);
  assert.equal((await call('/api/workspaces/face-search/20','PUT',{canManage:true})).status,200);assert.equal(f.grant().can_manage,1);
  const reads=await call('/api/workspaces/face-search/grants');assert.equal(reads.body[0].canManage,1);
  assert.equal((await call('/api/workspaces/face-search/20','PUT',{canManage:false})).status,200);assert.equal(f.grant().college_wide,1);assert.equal(f.grant().can_manage,0);
  assert.equal((await call('/api/workspaces/face-search/20','PUT',{canManage:'true'})).status,400);
  assert.equal((await call('/api/workspaces/face-search/999','PUT',{canManage:true})).status,404);
  assert.equal((await call('/api/workspaces/face-search/20','DELETE')).status,200);assert.equal(f.grant(),null);
 });
});
test('an admin-labelled contributor cannot grant or revoke any face ability',async()=>{
 const f=fixture();await serve(f,async call=>{for(const method of ['PUT','DELETE'])assert.equal((await call('/api/workspaces/face-search/20',method,{canManage:true,collegeAdmin:true})).status,403);});assert.equal(f.writes.length,0);
});

test('group managers can assign contributors and viewers but cannot change managers or other groups',async()=>{
 const f=fixture();f.workspace.role='manager';await serve(f,async call=>{
  for(const role of ['viewer','editor','member','contributor']){
   const r=await call('/api/workspaces/1/members/20','PUT',{role});assert.equal(r.status,200);
   assert.equal(f.roles.get(20),role==='viewer'?'viewer':'editor');
  }
  for(const [path,method,body]of [
   ['/api/workspaces/1/members/20','PUT',{role:'manager'}],
   ['/api/workspaces/1/members/21','PUT',{role:'viewer'}],
   ['/api/workspaces/1/members/21','DELETE'],
   ['/api/workspaces/2/members/20','PUT',{role:'viewer'}],
  ])assert.equal((await call(path,method,body)).status,403);
  assert.equal((await call('/api/workspaces/1/members/20','DELETE')).status,200);assert.equal(f.roles.has(20),false);
 });assert.equal(f.roles.get(21),'manager');
});

test('organization administrators can appoint managers but cannot add foreign organization accounts',async()=>{
 const f=fixture({collegeAdmin:true});await serve(f,async call=>{
  assert.equal((await call('/api/workspaces/1/members/20','PUT',{role:'manager'})).status,200);
  assert.equal(f.roles.get(20),'manager');
  assert.equal((await call('/api/workspaces/1/members/999','PUT',{role:'editor'})).status,404);
  assert.equal((await call('/api/workspaces/2/members/20','PUT',{role:'editor'})).status,403);
 });
});

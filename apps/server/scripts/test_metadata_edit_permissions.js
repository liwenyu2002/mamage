const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),express=require('express');
function load(file,deps){const module={exports:{}},actual=createRequire(file);vm.runInNewContext(fs.readFileSync(file,'utf8'),{
  module,exports:module.exports,process,console,Buffer,require:key=>Object.hasOwn(deps,key)?deps[key]:actual(key)},{filename:file});return module.exports;}
function fixture({role='editor',collegeAdmin=false,shared=false,readShare=false,race=false}={}){
  const workspace={enabled:true,userId:7,orgId:2,unitId:1,userRole:'admin',role,collegeAdmin};
  const state={photos:[{id:11,photo_id:11,project_id:9,projectId:9,organization_id:2,unit_id:1,photographer_id:7,photographerId:7,type:'normal'},
    {id:12,photo_id:12,project_id:9,projectId:9,organization_id:2,unit_id:1,photographer_id:8,photographerId:8,type:'video'},
    {id:13,photo_id:13,project_id:10,projectId:10,organization_id:2,unit_id:3,photographer_id:8,photographerId:8},
    {id:14,photo_id:14,project_id:9,projectId:9,organization_id:2,unit_id:1,photographer_id:null}],
    projects:[{id:9,organization_id:2,unit_id:1,admin_id:7,adminId:7,name:'Mine',meta:{}},
      {id:10,organization_id:2,unit_id:3,admin_id:8,adminId:8,name:'Shared',meta:{}},
      {id:15,organization_id:2,unit_id:1,admin_id:8,adminId:8,name:'Peer',meta:{}}],
    groups:[{id:'mine',name:'Mine',kind:'manual',createdBy:7,projectIds:[],parentId:null},
      {id:'other',name:'Other',kind:'manual',createdBy:8,projectIds:[],parentId:null},
      {id:'legacy',name:'Legacy',kind:'manual',projectIds:[],parentId:null}],revision:1,preferences:{pins:[],recentItems:[],colors:{},dismissed:[]},writes:[],rollbacks:0};
  const query=async(sql,params=[])=>{
    if(sql.includes('FROM folder_shares'))return [[]];
    if(sql.startsWith('SELECT role FROM users'))return [[{role:'admin'}]];
    if(sql.includes('FROM role_permissions'))return [[{permission:params[1]}]];
    if(sql.includes('FROM photos ph LEFT JOIN projects'))return [state.photos.filter(p=>(Array.isArray(params[0])?params[0]:[params[0]]).includes(p.id)).map(p=>({...p}))];
    if(sql.includes('SELECT 1 FROM internal_shares'))return [[...(shared||readShare?[{ok:1}]:[])].filter(()=>params[2]?.includes(shared?'collaborate':'read'))];
    if(sql.includes('SELECT DISTINCT ph.id')&&sql.includes('JOIN internal_shares'))return [shared?params.at(-1).map(id=>({id})):[]];
    if(sql.includes('FROM projects WHERE id = ?')||sql.includes('FROM projects p')&&sql.includes('p.id = ?'))return [state.projects.filter(p=>p.id===params[0]).map(p=>({...p}))];
    if(sql.startsWith('SELECT p.id')&&sql.includes('FROM projects'))return [state.projects.filter(p=>p.unit_id===1).map(p=>({...p,createdAt:'2026-10-16'}))];
    if(sql.startsWith('SELECT id FROM photos WHERE id =')){
      if(race&&sql.endsWith('FOR UPDATE'))state.photos.find(p=>p.id===11).photographer_id=8;
      return [state.photos.filter(p=>p.id===params[0]).map(p=>({...p}))];
    }
    if(sql.startsWith('SELECT id, project_id AS projectId FROM photos WHERE id IN'))return [state.photos.filter(p=>params[0].includes(p.id)).map(p=>({...p}))];
    if(sql.includes('FROM photos p')&&sql.includes('WHERE p.id ='))return [state.photos.filter(p=>p.id===params[0]).map(p=>({...p}))];
    if(sql.includes('FROM photos WHERE project_id'))return [[]];
    if(sql.startsWith('UPDATE photos SET')){
      assert.ok(!sql.includes('photographer_id'));const p=state.photos.find(p=>p.id===params.at(-1));
      if(sql.includes('timeline_section_id')){state.writes.push(sql);return [{affectedRows:params[1].length}];}
      const fields=[...sql.matchAll(/(description|tags|adjustments) = \?/g)].map(m=>m[1]);fields.forEach((field,i)=>p[field]=params[i]);state.writes.push(sql);return [{affectedRows:1}];
    }
    if(/UPDATE projects\s+SET/.test(sql)){state.writes.push(sql);state.projects.find(p=>p.id===params.at(-1)).name=params[0];return [{affectedRows:1}];}
    if(sql.includes('SELECT state, revision FROM album_desktop_workspaces'))return [[{state:{groups:state.groups},revision:state.revision}]];
    if(sql.includes('SELECT state, revision FROM album_desktop_users'))return [[{state:state.preferences,revision:1}]];
    if(sql.startsWith('UPDATE album_desktop_workspaces')){state.groups=JSON.parse(params[0]).groups;state.revision++;state.writes.push(sql);return [{affectedRows:1}];}
    if(sql.startsWith('UPDATE album_desktop_users')){state.preferences=JSON.parse(params[0]);state.writes.push(sql);return [{affectedRows:1}];}
    if(sql.startsWith('INSERT IGNORE')||sql.startsWith('SET TRANSACTION'))return [{}];
    throw Error('Unexpected SQL '+sql);
  };
  let snapshot;const conn={query,async beginTransaction(){snapshot=structuredClone({photos:state.photos,projects:state.projects,groups:state.groups,revision:state.revision,preferences:state.preferences});},
    async commit(){},async rollback(){state.rollbacks++;Object.assign(state,snapshot);},release(){}};
  const pool={query,getConnection:async()=>conn};
  const access=load(require.resolve('../lib/workspace_access'),{'../db':{pool}});
  const permissions=load(require.resolve('../lib/permissions'),{'../db':{pool},'./workspace_access':access});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:7,organization_id:2,role:'admin'};req.workspace={...workspace};next();});
  const router=express.Router(),source=fs.readFileSync(require.resolve('../routes/photos'),'utf8');
  const globals={router,pool,...access,requirePermission:permissions.requirePermission,populateReqUserFromAuthIfPresent:async()=>{},console,
    normalizePhotoAdjustments:value=>value,parsePhotoAdjustments:value=>value,buildMediaUrl:value=>value};
  vm.runInNewContext(source.slice(source.indexOf("router.param('id'"),source.indexOf('const AI_SEARCH_RATE_WINDOW_MS')),globals);
  vm.runInNewContext(source.slice(source.indexOf("router.patch('/:id'"),source.indexOf('module.exports = router;')),globals);app.use('/photos',router);
  vm.runInNewContext(source.slice(source.indexOf("router.post('/assign-section'"),source.indexOf('// POST /api/photos/group-rescue')),globals);
  const albums=express.Router(),albumSource=fs.readFileSync(require.resolve('../routes/projects'),'utf8');
  const albumGlobals={...globals,router:albums,parseMeta:value=>value||{},parseTags:value=>value||[],normalizeTagsInput:value=>value,
    getTimelineConfigFromBody:()=>null,attachTimelineToProject:async()=>{},chooseCoverFromPhotos:()=>({}),mediaUrl:(_req,value)=>value};
  vm.runInNewContext(albumSource.slice(albumSource.indexOf("router.param('id'"),albumSource.indexOf('// 小工具：安全解析 meta JSON')),albumGlobals);
  vm.runInNewContext(albumSource.slice(albumSource.indexOf("router.post('/:id/update'"),albumSource.indexOf('// 时间线环节单条 CRUD')),albumGlobals);
  app.use('/projects',albums);
  const desktop=load(require.resolve('../routes/album_desktop'),{'../db':{pool},'../lib/permissions':permissions,
    '../lib/workspace_access':access,'../lib/media_access':{buildMediaUrl:value=>value},
    '../lib/shared_albums':{listSharedAlbums:async()=>[]}});app.use('/desktop',desktop);
  const importsSource=fs.readFileSync(require.resolve('../routes/external_imports'),'utf8'),imports=express.Router();
  vm.runInNewContext(importsSource.slice(importsSource.indexOf("router.post('/sources/:id/hide'"),importsSource.indexOf('module.exports = router;')),
    {...globals,router:imports,validId:value=>Number(value),findJob:async()=>({job:{project_id:15,source_url:'https://fixture.invalid'}}),
      handleError:(res,error)=>access.sendWorkspaceError(res,error)||res.status(500).json({error:'unexpected'})});app.use('/imports',imports);
  const capability={exports:null};vm.runInNewContext(importsSource.slice(importsSource.indexOf('async function permissions('),importsSource.indexOf('function serializeJob('))+';module.exports=permissions;',
    {...globals,module:capability,hasPermissionForUserId:async()=>true});
  return {app,state,access,importPermissions:capability.exports,request:()=>({user:{id:7,organization_id:2,role:'admin'},workspace:{...workspace}})};
}
async function serve(f,fn){const server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{await fn(async(path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};});}
  finally{await new Promise(r=>server.close(r));}}

test('ordinary students can edit only their uploads, including metadata and tone adjustments',async()=>{
  for(const role of ['editor','member'])for(const payload of [{description:'Changed'},{tags:['Changed']},{adjustments:{brightness:10}}]){
    const f=fixture({role});await serve(f,async call=>{
      assert.ok([403,404].includes((await call('/photos/12','PATCH',payload)).status));
      assert.ok([403,404].includes((await call('/photos/14','PATCH',payload)).status));assert.equal(f.state.writes.length,0);
      assert.equal((await call('/photos/11','PATCH',payload)).status,200);
    });
  }
});
test('album metadata is creator-only for ordinary editors and malformed IDs do not bypass ownership',async()=>{
  const f=fixture();await serve(f,async call=>{
    for(const path of ['/projects/15/update','/projects/15junk/update']){
      assert.ok([400,403,404].includes((await call(path,'POST',{projectName:'Forged',adminId:7})).status));
    }
    assert.equal(f.state.writes.length,0);assert.equal((await call('/projects/9/update','POST',{projectName:'Mine changed'})).status,200);
  });
});
test('explicit collaborative shares remain editable but read-only shares do not grant metadata edits',async()=>{
  const shared=fixture({shared:true});await serve(shared,async call=>{assert.equal((await call('/photos/13','PATCH',{description:'Authorized'})).status,200);});
  const read=fixture({readShare:true});await serve(read,async call=>{assert.ok([403,404].includes((await call('/photos/13','PATCH',{description:'Denied'})).status));assert.equal(read.state.writes.length,0);});
});
test('administrators retain editing within their scope',async()=>{
  for(const options of [{role:'manager'},{collegeAdmin:true}]){
    const f=fixture(options);await serve(f,async call=>{assert.equal((await call('/photos/12','PATCH',{tags:['Admin']})).status,200);assert.equal((await call('/projects/15/update','POST',{projectName:'Admin'})).status,200);});
  }
});
test('folder ownership is immutable; old unknown owners and peers cannot be edited',async()=>{
  for(const id of ['other','legacy']){
    const f=fixture();await serve(f,async call=>{
      const groups=f.state.groups.map(g=>g.id===id?{...g,name:'Forged',createdBy:7}:g);
      assert.equal((await call('/desktop/state','PUT',{groups,workspaceRevision:1})).status,403);assert.equal(f.state.writes.length,0);
    });
  }
  const own=fixture();await serve(own,async call=>{
    const groups=own.state.groups.map(g=>g.id==='mine'?{...g,name:'Renamed',createdBy:8}:g);
    assert.equal((await call('/desktop/state','PUT',{groups,workspaceRevision:1})).status,200);
    assert.equal(own.state.groups.find(g=>g.id==='mine').createdBy,7);
  });
});
test('new folder owners are server-set, personal preferences stay writable, and other folders cannot be reordered',async()=>{
  const f=fixture();await serve(f,async call=>{
    assert.equal((await call('/desktop/state','PUT',{preferences:{pins:['group:other']},userRevision:1})).status,200);
    const groups=[...f.state.groups,{id:'new',name:'New',createdBy:8}];
    assert.equal((await call('/desktop/state','PUT',{groups,workspaceRevision:1})).status,200);assert.equal(f.state.groups.find(g=>g.id==='new').createdBy,7);
    const reversed=[...f.state.groups].reverse();const before=f.state.writes.length;
    assert.equal((await call('/desktop/state','PUT',{groups:reversed,workspaceRevision:2})).status,403);assert.equal(f.state.writes.length,before);
  });
});
test('photo ownership is rechecked after the row is locked',async()=>{
  const f=fixture({race:true});await serve(f,async call=>{assert.ok([403,404].includes((await call('/photos/11','PATCH',{description:'Stale'})).status));assert.equal(f.state.writes.length,0);assert.equal(f.state.rollbacks,1);});
});
test('mixed-owner section assignment is rejected atomically, own assignment still works',async()=>{
  const f=fixture();await serve(f,async call=>{
    assert.ok([403,404].includes((await call('/photos/assign-section','POST',{photoIds:[11,12],timelineSectionId:null})).status));
    assert.equal(f.state.writes.length,0);
    assert.equal((await call('/photos/assign-section','POST',{photoIds:[11],timelineSectionId:null})).status,200);
    assert.equal((await call('/photos/assign-section','POST',{photoIds:['11junk'],timelineSectionId:null})).status,400);
  });
});
test('external source notes and job controls do not elevate admin-labelled students',async()=>{
  const f=fixture();assert.equal((await f.importPermissions(f.request(),15)).canAdmin,false);
  await serve(f,async call=>{assert.ok([403,404].includes((await call('/imports/sources/1/hide','POST',{})).status));assert.equal(f.state.writes.length,0);});
  for(const options of [{role:'manager'},{collegeAdmin:true}]){
    const admin=fixture(options);assert.equal((await admin.importPermissions(admin.request(),15)).canAdmin,true);
  }
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');

function load(filename, dependencies) {
  const module = { exports:{} };
  const actual = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), { module,exports:module.exports,
    require:key=>Object.hasOwn(dependencies,key)?dependencies[key]:actual(key), process, console }, {filename});
  return module.exports;
}

function fixture({ role='editor', accountRole='admin', collegeAdmin=false, enabled=true, race=false, authenticated=true }={}) {
  const workspace={enabled,userId:7,orgId:2,userRole:accountRole,unitId:enabled?1:null,role,collegeAdmin};
  const initial=[
    {id:11,photo_id:11,project_id:9,projectId:9,organization_id:2,unit_id:enabled?1:null,photographer_id:7,type:'normal',url:'/own.jpg'},
    {id:12,photo_id:12,project_id:9,projectId:9,organization_id:2,unit_id:enabled?1:null,photographer_id:8,type:'normal',url:'/other.jpg'},
    {id:13,photo_id:13,project_id:9,projectId:9,organization_id:2,unit_id:enabled?1:null,photographer_id:7,type:'video',url:'/own.mp4'},
    {id:14,photo_id:14,project_id:9,projectId:9,organization_id:2,unit_id:enabled?1:null,photographer_id:null,url:'/unknown.jpg'},
    {id:15,photo_id:15,project_id:10,projectId:10,organization_id:2,unit_id:3,photographer_id:7,url:'/foreign-unit.jpg'},
    {id:16,photo_id:16,project_id:11,projectId:11,organization_id:3,unit_id:1,photographer_id:7,url:'/foreign-org.jpg'},
    {id:17,photo_id:17,project_id:12,projectId:12,organization_id:2,unit_id:1,photographer_id:7,restricted_to_user_id:99,url:'/restricted.jpg'},
  ];
  const state={photos:structuredClone(initial),deleted:[],commits:0,rollbacks:0,cleanup:0};
  const query=async(sql,params=[])=>{
    if(sql.startsWith('SELECT role FROM users'))return [[{role:accountRole}]];
    if(sql.includes('FROM role_permissions'))return [accountRole==='admin'||accountRole==='superadmin'||params[1]==='upload.photo'?[{allowed:1}]:[]];
    if(sql.includes('FROM photos ph LEFT JOIN projects'))return [state.photos.filter(photo=>(Array.isArray(params[0])?params[0]:[params[0]]).includes(photo.id)).map(photo=>({...photo}))];
    if(sql.includes('SELECT 1 FROM internal_share_items'))return [[]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM photos WHERE id IN')){
      assert.ok(sql.endsWith('FOR UPDATE'),'destructive ownership checks must hold row locks');
      if(race)state.photos.find(photo=>photo.id===11).photographer_id=8;
      return [state.photos.filter(photo=>params[0].includes(photo.id)).map(photo=>({...photo}))];
    }
    if(sql.startsWith('DELETE FROM photos')){
      state.deleted.push(...params[0]);state.photos=state.photos.filter(photo=>!params[0].includes(photo.id));return [{affectedRows:params[0].length}];
    }
    if(sql.startsWith('SELECT id FROM photos WHERE id ='))return [state.photos.filter(photo=>photo.id===params[0]&&photo.organization_id===params[1])];
    if(sql.startsWith('UPDATE photos SET')){
      assert.ok(!sql.includes('photographer_id'),'uploader identity must not be editable');
      state.photos.find(photo=>photo.id===params.at(-1)).description=params[0];return [{affectedRows:1}];
    }
    if(sql.includes('FROM photos p')&&sql.includes('WHERE p.id ='))return [state.photos.filter(photo=>photo.id===params[0])];
    if(sql.includes('SELECT photo_ids FROM projects'))return [[{photo_ids:'[11,12,13,14]'}]];
    if(sql.startsWith('UPDATE projects SET photo_ids'))return [{affectedRows:1}];
    if(sql.includes('internal_shares')||sql.includes('face_search_grants'))return [[]];
    throw Error('Unexpected query: '+sql);
  };
  let snapshot;
  const conn={query,async beginTransaction(){snapshot=structuredClone(state.photos);},
    async commit(){state.commits++;},async rollback(){state.rollbacks++;state.photos=snapshot||state.photos;},release(){}};
  const pool={query,getConnection:async()=>conn};
  const access=load(require.resolve('../lib/workspace_access'),{'../db':{pool}});
  const permissions=load(require.resolve('../lib/permissions'),{'../db':{pool},'./workspace_access':access});
  const router=express.Router();
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{if(authenticated)req.user={id:7,role:accountRole,organization_id:2,permissions:['photos.view','photos.delete']};req.workspace={...workspace};next();});
  const source=fs.readFileSync(require.resolve('../routes/photos'),'utf8');
  vm.runInNewContext(source.slice(source.indexOf('// 照片删除'),source.indexOf('// POST /api/photos/assign-section')),{
    router,pool,requirePermission:permissions.requirePermission,requirePhotosAccess:access.requirePhotosAccess,
    assertNoActiveCopySource:access.assertNoActiveCopySource,sendWorkspaceError:access.sendWorkspaceError,
    MAX_DELETE_PHOTOS:200,console:{log(){},info(){},error(){}},setImmediate:()=>{state.cleanup++;},
    parseProjectPhotoIds:value=>JSON.parse(value),cleanupDeletedPhotoRows:async()=>{},
  });
  vm.runInNewContext(source.slice(source.indexOf("router.patch('/:id'"),source.indexOf('module.exports = router;')),{
    router,pool,requirePermission:permissions.requirePermission,requirePhotoAccess:access.requirePhotoAccess,sendWorkspaceError:access.sendWorkspaceError,console,normalizePhotoAdjustments:value=>value,
    parsePhotoAdjustments:value=>value,buildMediaUrl:value=>value,
  });
  app.use('/api/photos',router);
  const albums=express.Router(),projectSource=fs.readFileSync(require.resolve('../routes/projects'),'utf8');
  vm.runInNewContext(projectSource.slice(projectSource.indexOf("router.delete('/:id',"),projectSource.indexOf('module.exports = router;')),
    {router:albums,requirePermission:permissions.requirePermission,console});
  app.use('/api/projects',albums);
  const meRouter=express.Router();
  const users=fs.readFileSync(require.resolve('../routes/users'),'utf8');
  vm.runInNewContext(users.slice(users.indexOf("router.get('/me'"),users.indexOf("router.put('/me'")),{
    router:meRouter,pool,authMiddleware:(_req,_res,next)=>next(),console,
    require:key=>{
      if(key==='../lib/workspace_access')return access;
      if(key==='../lib/access_policy')return require('../lib/access_policy');
      if(key==='../lib/face_access')return{getFacePermissions:async()=>({search:false,manage:false})};
      throw Error('Unexpected module '+key);
    },
  });
  app.use('/api/users',meRouter);
  return {app,state,access,workspace,request:()=>({user:{id:7,role:accountRole,organization_id:2},workspace:{...workspace}})};
}

async function serve(f,fn) {
  const server=f.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {await fn(async(photoIds,extra={})=>{
    const response=await fetch(base+'/api/photos/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({photoIds,...extra})});
    return {status:response.status,body:await response.json()};
  },async()=>{const response=await fetch(base+'/api/users/me');assert.equal(response.status,200);return response.json();},
  async(path,method,body)=>{
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  });}
  finally{await new Promise(resolve=>server.close(resolve));}
}

test('an admin-labelled editor cannot delete another uploader or a mixed batch, and forged ownership is ignored',async()=>{
  for(const ids of [[12],[11,12],[14]]){
    const f=fixture();await serve(f,async remove=>{
      const result=await remove(ids,{photographerId:7,photographer_id:7,userId:8,role:'manager'});
      assert.equal(result.status,403);assert.equal(result.body.error,'PHOTO_DELETE_FORBIDDEN');
      assert.deepEqual(f.state.deleted,[]);assert.equal(f.state.cleanup,0);assert.equal(f.state.commits,0);
    });
  }
});

test('members and editors can delete their own photo and video, without expanding album management',async()=>{
  for(const role of ['member','editor']){
    const f=fixture({role});await serve(f,async(remove,me)=>{
      const user=await me();assert.equal(user.photoDeleteScope,'own');assert.ok(user.permissions.includes('photos.delete'));
      assert.ok(user.permissions.includes('upload.photo'));
      assert.ok(!user.permissions.includes('projects.delete'));
      const result=await remove([11,13]);assert.equal(result.status,200);assert.deepEqual(result.body.deletedIds,[11,13]);
      assert.deepEqual(f.state.deleted,[11,13]);assert.equal(f.state.commits,1);
    });
  }
});

test('unit managers and college administrators retain their existing scoped deletion permissions',async()=>{
  for(const options of [{role:'manager'},{collegeAdmin:true}]){
    const f=fixture(options);await serve(f,async(remove,me)=>{
      const user=await me();assert.equal(user.photoDeleteScope,options.collegeAdmin?'organization':'unit');
      assert.ok(user.permissions.includes('projects.delete'));
      assert.equal((await remove([12,14])).status,200);
    });
  }
});

test('ownership never bypasses organization, current unit, restricted album or mixed visibility checks',async()=>{
  for(const ids of [[15],[16],[17],[11,15],[999]]){
    const f=fixture();await serve(f,async remove=>{assert.equal((await remove(ids)).status,404);assert.deepEqual(f.state.deleted,[]);});
  }
  const manager=fixture({role:'manager'});await serve(manager,async remove=>{assert.equal((await remove([15])).status,404);});
});

test('uploader ownership is rechecked after row locks, so a stale precheck cannot authorize deletion',async()=>{
  const f=fixture({race:true});await serve(f,async remove=>{
    assert.equal((await remove([11])).status,403);assert.equal(f.state.rollbacks,1);assert.equal(f.state.commits,0);
    assert.deepEqual(f.state.deleted,[]);assert.equal(f.state.cleanup,0);
  });
});

test('single-photo and batch access agree, and old ungrouped photographers are also own-only',async()=>{
  const f=fixture();
  await assert.rejects(f.access.requirePhotoAccess(f.request(),12,'delete'),error=>error.code==='PHOTO_DELETE_FORBIDDEN');
  assert.equal((await f.access.requirePhotoAccess(f.request(),11,'delete')).photo_id,11);
  const legacy=fixture({enabled:false,accountRole:'photographer'});
  await serve(legacy,async(remove,me)=>{
    assert.equal((await me()).photoDeleteScope,'own');
    assert.equal((await remove([12])).status,403);assert.equal((await remove([11,13])).status,200);
  });
});

test('unauthenticated users and users without membership cannot delete; malformed IDs cannot select unintended photos',async()=>{
  const anonymous=fixture({authenticated:false});await serve(anonymous,async remove=>{
    assert.equal((await remove([11])).status,401);assert.deepEqual(anonymous.state.deleted,[]);
  });
  const outsider=fixture({role:null});await serve(outsider,async remove=>{
    assert.equal((await remove([11])).status,403);assert.deepEqual(outsider.state.deleted,[]);
  });
  for(const ids of [[11,'12junk'],[0],[-1],[1.5],[true],[null],[{id:11}]]){
    const f=fixture();await serve(f,async remove=>{assert.equal((await remove(ids)).status,400);assert.deepEqual(f.state.deleted,[]);});
  }
});

test('ordinary users cannot delete via the album endpoint or steal uploader identity via PATCH',async()=>{
  for(const role of ['member','editor']){
    const f=fixture({role});await serve(f,async(remove,_me,request)=>{
      assert.equal((await request('/api/projects/9','DELETE')).status,403);
      if(role==='editor'){
        assert.equal((await request('/api/photos/12','PATCH',{photographer_id:7,photographerId:7})).status,400);
        assert.ok([403,404].includes((await request('/api/photos/12','PATCH',{description:'fixture',photographer_id:7,photographerId:7})).status));
      }
      assert.equal(f.state.photos.find(photo=>photo.id===12).photographer_id,8);
      assert.equal((await remove([12])).status,403);assert.deepEqual(f.state.deleted,[]);
    });
  }
});

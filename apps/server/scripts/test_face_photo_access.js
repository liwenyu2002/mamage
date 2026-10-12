const assert = require('node:assert/strict');
const express = require('express');
const actions = [];
const mock = (name, exports) => { const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports}; };
mock('../db',{pool:{query:async sql=>{
  if(sql.includes('face_search_grants'))return [[{college_wide:1}]];
  if(sql.includes('organization_access_audit'))return [{}];
  throw new Error('Photo query must not run before ACL: '+sql);
}}});
mock('../lib/permissions',{requirePermission:()=> (req,res,next)=>{req.user={id:7,organization_id:2};next();}});
mock('../lib/media_access',{buildMediaUrl:p=>p});
mock('../lib/workspace_access',{
  resolveWorkspace:async()=>({enabled:true,orgId:2,userId:7,unitId:2}),
  requirePhotoAccess:async(_req,_id,action)=>{actions.push(action);throw Object.assign(new Error('PHOTO_NOT_FOUND'),{status:404});},
  sendWorkspaceError:(res,error)=>{if(!error.status)return false;res.status(error.status).json({error:error.message});return true;},
});
mock('../lib/face_detector',{});mock('../lib/face_avatar',{});mock('../lib/face_feedback',{});
const app=express();app.use(express.json());app.use('/api',require('../routes/faces'));
const server=app.listen(0,'127.0.0.1',async()=>{
  try{
    const url=`http://127.0.0.1:${server.address().port}/api/photos/77/faces`;
    assert.equal((await fetch(url)).status,404);
    assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"faces":[]}'})).status,404);
    assert.equal((await fetch(url+'?detect=1')).status,404);
    assert.deepEqual(actions,['read','edit','edit']);
    console.log('PASS: photo route parameters enforce face read/edit ACL before queries or mutations');
  }catch(error){console.error(error);process.exitCode=1;}finally{server.close();}
});

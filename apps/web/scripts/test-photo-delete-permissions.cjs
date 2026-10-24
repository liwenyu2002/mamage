const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const vm=require('node:vm');
const Module=require('node:module');
const babel=require('@babel/core');
const filename=require('node:path').join(__dirname,'../src/utils/photoDeletePermissions.js');
const loaded=new Module(filename,module);loaded.filename=filename;
loaded._compile(babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,filename);
const {canDeletePhoto,getPhotoDeleteErrorMessage,isPhotoUploadedBy}=loaded.exports;
const student={id:7,role:'admin',permissions:['photos.delete'],activeUnitId:1,photoDeleteScope:'own'};
const photo={id:11,unitId:1,photographerId:7};

test('an admin label does not elevate ordinary students; unknown ownership is never deletable',()=>{
  assert.equal(canDeletePhoto(photo,student),true);
  for(const value of [{...photo,photographerId:8},{...photo,photographerId:null},{...photo,photographerId:0},
    {...photo,photographerId:'7x'},{id:11,unitId:1,userId:7}])assert.equal(canDeletePhoto(value,student),false);
  assert.equal(canDeletePhoto({...photo,photographerId:'7',type:'video'},student),true);
  assert.equal(canDeletePhoto({...photo,unitId:2},student),false);
  assert.equal(canDeletePhoto(photo,student,{readOnly:true}),false);
  assert.equal(canDeletePhoto(photo,{...student,photoDeleteScope:undefined}),false);
  assert.equal(canDeletePhoto(photo,{...student,permissions:[]}),false);
});

test('my uploads filtering uses uploader IDs independently of administrator status or deletion grants',()=>{
  const photos=[photo,{...photo,id:12,photographerId:8},{...photo,id:13,photographerId:'7',type:'video'},
    {...photo,id:14,photographerId:null}];
  assert.deepEqual(photos.filter(item=>isPhotoUploadedBy(item,7)).map(item=>item.id),[11,13]);
  assert.deepEqual(photos.filter(item=>isPhotoUploadedBy(item,null)),[]);
  assert.equal(isPhotoUploadedBy({photographer_id:7},7),true);
});

test('administrators retain only their declared scope and ungrouped authors remain own-only',()=>{
  assert.equal(canDeletePhoto({...photo,photographerId:8},{...student,photoDeleteScope:'unit'}),true);
  assert.equal(canDeletePhoto({...photo,unitId:2},{...student,photoDeleteScope:'unit'}),false);
  assert.equal(canDeletePhoto({...photo,unitId:2,photographerId:null},{...student,photoDeleteScope:'organization'}),true);
  assert.equal(canDeletePhoto({id:11,photographerId:7},{...student,activeUnitId:null}),true);
  assert.equal(canDeletePhoto({id:11,photographerId:7},student,{projectUnitId:1}),true);
});

test('deletion denial is sent once and preserves the server status instead of trying legacy write endpoints',async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/services/photoService.js'),'utf8');
  let calls=0;
  const denied=Object.assign(Error('PHOTO_DELETE_FORBIDDEN'),{status:403,body:'{"error":"PHOTO_DELETE_FORBIDDEN"}'});
  const context={request:async(path,options)=>{calls++;assert.equal(path,'/api/photos/delete');assert.equal(options.method,'POST');throw denied;}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function deletePhotos('),source.indexOf('// 合影救场：')),context);
  await assert.rejects(context.deletePhotos([11,12]),error=>error===denied);
  assert.equal(calls,1);assert.ok(getPhotoDeleteErrorMessage(denied).includes('自己上传'));
});

const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),babel=require('@babel/core');
const code=babel.transformFileSync(path.join(__dirname,'../src/utils/metadataEditPermissions.js'),{presets:[require.resolve('@babel/preset-env')]}).code;
const mod={exports:{}};new Function('module','exports',code)(mod,mod.exports);const {canEditMetadata}=mod.exports;
const user={id:7,role:'admin',activeUnitId:1,metadataEditScope:'own',permissions:['photos.edit','projects.update']};
test('admin account labels cannot edit peer uploads; own photos and videos remain editable',()=>{
  for(const type of ['normal','video']){
    assert.equal(canEditMetadata({photographerId:7,unitId:1,type},user),true);
    assert.equal(canEditMetadata({photographerId:8,unitId:1,type},user),false);
  }
  assert.equal(canEditMetadata({unitId:1},user),false);
  assert.equal(canEditMetadata({photographerId:7,unitId:3},user),false);
});
test('album creators and server-authorized collaborators can edit, read-only grants cannot',()=>{
  assert.equal(canEditMetadata({adminId:7,unitId:1},user,{kind:'album'}),true);
  assert.equal(canEditMetadata({adminId:8,unitId:1},user,{kind:'album'}),false);
  assert.equal(canEditMetadata({adminId:8,canEdit:true},user,{kind:'album'}),true);
  assert.equal(canEditMetadata({photographerId:7,canEdit:false},user),false);
  assert.equal(canEditMetadata({canEdit:true},user,{readOnly:true}),false);
});
test('missing identity, capability or permission fails closed even with a resource grant',()=>{
  for(const actor of [null,{...user,id:null},{...user,metadataEditScope:undefined},{...user,permissions:[]}]){
    assert.equal(canEditMetadata({canEdit:true},actor),false);
  }
});
test('managers retain their scope and college administrators retain organization editing',()=>{
  assert.equal(canEditMetadata({unitId:1},{...user,metadataEditScope:'unit'}),true);
  assert.equal(canEditMetadata({unitId:3},{...user,metadataEditScope:'unit'}),false);
  assert.equal(canEditMetadata({unitId:3},{...user,metadataEditScope:'organization'}),true);
});

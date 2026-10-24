const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),babel=require('@babel/core');
const code=babel.transformFileSync(path.join(__dirname,'../src/utils/albumUploadLink.js'),{presets:[require.resolve('@babel/preset-env')]}).code;
const mod={exports:{}};new Function('module','exports',code)(mod,mod.exports);
const {buildAlbumUploadUrl,readAlbumUploadIntent,rememberAlbumUploadIntent,storedAlbumUploadIntent,clearAlbumUploadIntent}=mod.exports;
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
test('upload links carry only validated album/workspace IDs, no tokens or redirect URL',()=>{
  const url=buildAlbumUploadUrl(83,1,'http://10.1.131.37/anything?token=private');
  assert.equal(url,'http://10.1.131.37/?projectId=83&upload=1&unitId=1');
  assert.deepEqual(readAlbumUploadIntent(url),{projectId:'83',unitId:'1'});
  assert.equal(readAlbumUploadIntent('http://host/?projectId=83'),null);
  for(const value of ['0','-1','83x','1e3','99999999999'])assert.throws(()=>buildAlbumUploadUrl(value,1,'http://host'));
  assert.throws(()=>buildAlbumUploadUrl(83,1,'javascript:alert(1)'));
  assert.equal(readAlbumUploadIntent('http://host/share/code?projectId=83&upload=1'),null);
  assert.equal(readAlbumUploadIntent('http://host/?projectId=83&upload=1&unitId=evil'),null);
});
test('a short-lived same-tab intent survives OAuth and is consumed after opening, with no open redirect',()=>{
  const s=storage(),intent={projectId:'83',unitId:'1',returnTo:'https://evil.invalid'};
  rememberAlbumUploadIntent(s,intent,1000);
  assert.deepEqual(storedAlbumUploadIntent(s,2000),{projectId:'83',unitId:'1'});
  assert.equal(storedAlbumUploadIntent(s,1000+31*60*1000),null);
  assert.equal(storedAlbumUploadIntent(s,500),null);
  clearAlbumUploadIntent(s);assert.equal(storedAlbumUploadIntent(s),null);
  const disabled={getItem:()=>{throw Error('disabled')},setItem:()=>{throw Error('disabled')},removeItem:()=>{throw Error('disabled')}};
  assert.equal(storedAlbumUploadIntent(disabled),null);rememberAlbumUploadIntent(disabled,intent);clearAlbumUploadIntent(disabled);
});

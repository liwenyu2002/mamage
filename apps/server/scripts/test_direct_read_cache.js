const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const calls=[],module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/cos_storage.js'),'utf8'),{
  module,process:{env:{COS_FORCE_PATH_STYLE:'1'}},Buffer,URL,Date,Map,Set,console,
  require(name){
   if(name==='../config/keys')return{COS_SECRET_ID:'isolated-key',COS_SECRET_KEY:'isolated-secret',COS_BUCKET:'isolated-bucket',COS_REGION:'us-east-1',COS_BASE_URL:'http://storage.test'};
   if(name==='@aws-sdk/s3-request-presigner')return{getSignedUrl:async(_client,command,options)=>{calls.push({input:command.input,options});return'http://storage.test/signed';}};
   return require(name);
  },
 });
 return{storage:module.exports,calls};
}
test('private download signatures override immutable object metadata with no-store',async()=>{
 const f=fixture();await f.storage.signedGetUrl('uploads/units/1/video.mp4',{downloadName:'video.mp4',expires:60});
 assert.equal(f.calls[0].input.ResponseCacheControl,'private, no-store');assert.equal(f.calls[0].options.expiresIn,60);
 assert.match(f.calls[0].input.ResponseContentDisposition,/^attachment/);
});
test('ordinary preview signatures retain their existing caching behavior',async()=>{
 const f=fixture();await f.storage.signedGetUrl('uploads/units/1/video.mp4',{expires:60});
 assert.equal(f.calls[0].input.ResponseCacheControl,undefined);assert.equal(f.calls[0].input.ResponseContentDisposition,undefined);
});

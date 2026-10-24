const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const {createRequire}=require('node:module'),runtime=createRequire(path.resolve(__dirname,'../package.json'));
const {transformSync}=runtime('@babel/core');
const code=transformSync(fs.readFileSync(path.resolve(__dirname,'../src/services/directStorage.js'),'utf8'),{
  filename:'directStorage.js',configFile:false,babelrc:false,plugins:[runtime.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
function fixture(handler){
 let clock=100000,token='actor-a';const calls=[],module={exports:{}};
 const sandbox={module,exports:module.exports,window:{location:{protocol:'http:'}},Map,Promise,Number,Math,JSON,encodeURIComponent,AbortController,setTimeout,clearTimeout,
  Date:class extends Date{static now(){return clock;}},
  require(name){if(name==='./request')return{BASE_URL:'',request:async()=>({})};if(name==='./authService')return{getToken:()=>token};if(name==='./mediaDownload')return{createMediaDownloader:()=>()=>{}};throw Error(name);},
  fetch:async(url,input)=>{calls.push({url,input});const body=await handler(url,input,{clock:()=>clock,advance:n=>{clock+=n;}});return{ok:body.status?body.status<400:true,status:body.status||200,json:async()=>body};},
 };
 vm.runInNewContext(code,sandbox,{filename:'directStorage.js'});
 return{api:module.exports,calls,advance:n=>{clock+=n;},setToken:value=>{token=value;}};
}
test('a transient eligibility error does not disable direct downloads until the page reloads',async()=>{
 let attempts=0;const f=fixture(async url=>{if(url.endsWith('direct-status')){if(++attempts===1)throw Error('temporary network');return{eligible:true};}return{url:'http://storage/fresh',expiresIn:60};});
 assert.equal((await f.api.getDirectStorageStatus()).eligible,false);
 assert.equal(await f.api.getDirectMediaUrl(1,'original',{download:true}),'http://storage/fresh');assert.equal(attempts,2);
});
test('signature cache lifetime includes time spent waiting for the signing API',async()=>{
 let signed=0;const f=fixture(async(url,_input,time)=>{if(url.endsWith('direct-status'))return{eligible:true};if(++signed===1)time.advance(45000);return{url:'http://storage/'+signed,expiresIn:60};});
 await f.api.getDirectMediaUrl(1,'original',{download:true});await f.api.getDirectMediaUrl(1,'original',{download:true});assert.equal(signed,2);
});
test('short advertised lifetimes are not silently inflated to a minute',async()=>{
 let signed=0;const f=fixture(async url=>url.endsWith('direct-status')?{eligible:true}:{url:'http://storage/'+(++signed),expiresIn:10});
 await f.api.getDirectMediaUrl(1);f.advance(12000);await f.api.getDirectMediaUrl(1);assert.equal(signed,2);
});
test('forceRefresh bypasses a cached signed link',async()=>{
 let signed=0;const f=fixture(async url=>url.endsWith('direct-status')?{eligible:true}:{url:'http://storage/'+(++signed),expiresIn:900});
 await f.api.getDirectMediaUrl(1);assert.equal(await f.api.getDirectMediaUrl(1,'original',{forceRefresh:true}),'http://storage/2');
});
test('cached authorization results do not cross account changes',async()=>{
 let signed=0;const f=fixture(async url=>url.endsWith('direct-status')?{eligible:true}:{url:'http://storage/'+(++signed),expiresIn:900});
 await f.api.getDirectMediaUrl(1);f.setToken('actor-b');assert.equal(await f.api.getDirectMediaUrl(1),'http://storage/2');
 assert.ok(f.calls.filter(c=>c.url.includes('direct-url')).at(-1).input.headers.Authorization.endsWith('actor-b'));
});
test('signing and eligibility requests bypass HTTP caches',async()=>{
 const f=fixture(async url=>url.endsWith('direct-status')?{eligible:true}:{url:'http://storage/fresh',expiresIn:60});
 await f.api.getDirectMediaUrl(1);assert.ok(f.calls.every(c=>c.input.cache==='no-store'));
});
test('concurrent reads share one signing request instead of creating a burst',async()=>{
 let signed=0;const f=fixture(async url=>url.endsWith('direct-status')?{eligible:true}:{url:'http://storage/'+(++signed),expiresIn:900});
 const urls=await Promise.all(Array.from({length:10},()=>f.api.getDirectMediaUrl(1)));
 assert.equal(signed,1);assert.ok(urls.every(url=>url==='http://storage/1'));
});
test('a late signing response from the previous account cannot repopulate the cache',async()=>{
 let release,signed=0;
 const f=fixture(async url=>{if(url.endsWith('direct-status'))return{eligible:true};if(++signed===1)return new Promise(resolve=>{release=()=>resolve({url:'http://storage/old',expiresIn:900});});return{url:'http://storage/new',expiresIn:900};});
 const old=f.api.getDirectMediaUrl(1);await new Promise(resolve=>setImmediate(resolve));
 f.setToken('actor-b');assert.equal(await f.api.getDirectMediaUrl(1),'http://storage/new');release();assert.equal(await old,null);
 assert.equal(await f.api.getDirectMediaUrl(1),'http://storage/new');assert.equal(signed,2);
});
test('changing the active workspace clears signed links only after the server accepts the switch',async()=>{
 const source=transformSync(fs.readFileSync(path.resolve(__dirname,'../src/services/workspaceService.js'),'utf8'),{
  filename:'workspaceService.js',configFile:false,babelrc:false,plugins:[runtime.resolve('@babel/plugin-transform-modules-commonjs')],
 }).code;
 const module={exports:{}};let clears=0,allowed=true;
 vm.runInNewContext(source,{module,exports:module.exports,require(name){
  if(name==='./request')return{request:async()=>{if(!allowed)throw Error('forbidden');return{ok:true};}};
  if(name==='./directStorage')return{clearDirectMediaUrlCache:()=>{clears++;}};throw Error(name);
 }});
 await module.exports.setActiveWorkspace(2);assert.equal(clears,1);
 allowed=false;await assert.rejects(module.exports.setActiveWorkspace(3),/forbidden/);assert.equal(clears,1);
});

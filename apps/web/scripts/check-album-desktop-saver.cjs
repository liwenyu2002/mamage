const assert=require('node:assert/strict');
const babel=require('@babel/core');
const code=babel.transformFileSync(require('node:path').join(__dirname,'../src/services/albumDesktopService.js'),{presets:[require.resolve('@babel/preset-env')]}).code;
const calls=[];let workspaceRevision=2,userRevision=3;
const mod={exports:{}};
new Function('require','module','exports',code)(()=>({request:async(path,options)=>{
  const body=options.data;calls.push(body);
  await new Promise(resolve=>setTimeout(resolve,20));
  if(body.groups && body.workspaceRevision!==workspaceRevision)throw new Error('conflict');
  if(body.preferences && body.userRevision!==userRevision)throw new Error('conflict');
  if(body.groups)workspaceRevision++;if(body.preferences)userRevision++;
  return {workspaceRevision,userRevision};
}}),mod,mod.exports);
const initial={groups:[{id:'a',projectIds:[1,2]}],preferences:{pins:[]},workspaceRevision,userRevision};
const errors=[];const saver=mod.exports.createDesktopSaver(initial,e=>errors.push(e.message));
(async()=>{
 await saver.save({groups:[{id:'a',projectIds:[2,1]}],preferences:{pins:[]}});assert.equal(calls.length,0);
 const one=saver.save({...initial,preferences:{pins:['album:1']}});
 await new Promise(resolve=>setTimeout(resolve,1));
 saver.save({...initial,preferences:{pins:['album:2']}});
 await one;assert.equal(calls.length,2);assert.deepEqual(calls[1].preferences.pins,['album:2']);
 await saver.save({...initial,preferences:{pins:[]}});assert.equal(calls.length,3);
 workspaceRevision=8;
 await saver.save({...initial,preferences:{pins:['album:1']}});
 await saver.save({...initial,groups:[{id:'b',projectIds:[]}],preferences:{pins:['album:1']}});
 assert.deepEqual(errors,['conflict']);assert.equal(calls.at(-1).workspaceRevision,2);
 assert.equal(await saver.save(initial),false);
 console.log('PASS: saver no-op, coalescing, serial writes, subsequent writes and cross-tab revision protection');
})().catch(e=>{console.error(e);process.exitCode=1});

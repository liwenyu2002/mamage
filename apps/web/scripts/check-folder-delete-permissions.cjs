const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dist=path.resolve(process.env.MAMAGE_DIST || path.join(__dirname,'../dist'));
const output=process.env.MAMAGE_QA_OUTPUT;
let activeCase;
const server=http.createServer((req,res)=>{
  const file=path.join(dist,new URL(req.url,'http://fixture.test').pathname);
  const target=file.startsWith(dist+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()?file:dist+'/index.html';
  res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(target).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true}),results=[];
  try{
    for(const role of ['member','editor','manager','college','missing'])for(const style of ['glass','classic'])for(const width of [1440,390]){
      activeCase={role,style,width};
      const admin=['manager','college'].includes(role),organize=role!=='member';
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.addInitScript(style=>{localStorage.setItem('mamage_jwt_token','fixture');localStorage.setItem('mamage-folder-style:v1:7',style);},style);
      const groups=[{id:'root',name:'权限文件夹',kind:'manual',createdBy:7,canEdit:organize,parentId:null,projectIds:[9],rule:{}},
        {id:'child',name:'子文件夹',kind:'manual',parentId:'root',projectIds:[],rule:{}}];
      const album={id:9,name:'权限相册',projectName:'权限相册',title:'权限相册',createdAt:'2026-10-16T00:00:00Z',count:0,photoCount:0,photos:[]};
      const state={albums:[album],groups,preferences:{pins:[],recentItems:[],colors:{},dismissed:[]},workspaceRevision:1,userRevision:1,
        canOrganize:organize,...(role==='missing'?{}:{canDeleteFolders:admin}),scope:{userId:7,organizationId:2,unitId:1}};
      const writes=[];
      await context.route('**/api/**',async route=>{
        const req=route.request(),p=new URL(req.url()).pathname;let data={};
        if(p==='/api/users/me')data={id:7,name:'权限验收',role:'admin',permissions:['photos.view','projects.view','projects.update',...(admin?['projects.delete']:[])]};
        else if(p==='/api/workspaces')data={enabled:true,activeUnitId:1,units:[{id:1,name:'测试小组',role:admin?'manager':'editor'}]};
        else if(p==='/api/album-desktop')data=state;
        else if(p==='/api/album-desktop/state'){
          const body=req.postDataJSON();writes.push(body);
          if(body.groups){state.groups=body.groups;state.workspaceRevision++;}
          if(body.preferences){state.preferences=body.preferences;state.userRevision++;}
          data={workspaceRevision:state.workspaceRevision,userRevision:state.userRevision};
        }else if(p==='/api/projects/list')data={list:[album],total:1,hasMore:false};
        else if(p==='/api/projects')data=[album];
        else if(p==='/api/projects/import-status')data={statuses:{}};
        else if(p==='/api/projects/9')data=album;
        else if(req.method()!=='GET')throw Error('Unexpected write '+p);
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
      await page.locator('.album-desktop').waitFor();
      await page.waitForTimeout(350);
      if(style==='glass')await page.getByRole('button',{name:'更多操作 权限文件夹',exact:true}).click();
      else await page.getByRole('button',{name:'文件操作 权限文件夹',exact:true}).click();
      await page.getByRole('menu').waitFor();
      const edit=page.getByRole('menuitem',{name:'编辑文件夹',exact:true});
      assert.equal(await edit.count(),organize?1:0);
      if(organize){
        await edit.click();
        const dialog=page.getByRole('dialog').last();
        await dialog.getByRole('button',{name:'保存名称',exact:true}).waitFor();
        assert.equal(await dialog.getByRole('button',{name:'删除文件夹',exact:true}).count(),admin?1:0);
        assert.equal(await dialog.getByRole('button',{name:'保存名称',exact:true}).count(),1);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        if(output)await page.screenshot({path:path.join(output,`folder-${role}-${style}-${width}.png`)});
        if(admin){
          await dialog.getByRole('button',{name:'删除文件夹',exact:true}).click();
          await page.getByRole('button',{name:'确认删除文件夹',exact:true}).click();
          await page.waitForTimeout(700);
          assert.ok(!state.groups.some(group=>group.id==='root'));
          assert.equal(state.groups.find(group=>group.id==='child').parentId,null);
          assert.equal(state.albums.length,1);
        }else{
          await dialog.locator('input').fill('改名仍可用');
          await dialog.getByRole('button',{name:'保存名称',exact:true}).click();
          await page.waitForTimeout(700);
          assert.equal(state.groups.find(group=>group.id==='root').name,'改名仍可用');
          assert.equal(state.groups.length,2);
        }
      }
      assert.deepEqual(errors,[]);
      results.push({role,style,width,deleteAllowed:admin,organizePreserved:organize,errors:0});
      await context.close();
    }
    if(output)fs.writeFileSync(path.join(output,'browser-qa.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({status:'passed',cases:results.length,styles:['glass','classic'],widths:[1440,390],ordinaryAndAdmin:true}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(JSON.stringify(activeCase),e.stack);server.close();process.exitCode=1;});

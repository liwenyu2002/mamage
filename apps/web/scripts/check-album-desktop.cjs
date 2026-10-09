const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../dist');
const copy = value => JSON.parse(JSON.stringify(value));
const albums = Array.from({length:12},(_,index)=>({id:index+1,name:`校园活动 ${index+1}`,title:`校园活动 ${index+1}`,
  image:`https://desktop.test/photo-${index+1}.svg`,count:20+index,createdAt:'2026-10-01T00:00:00Z',updatedAt:`2026-10-${String(index+1).padStart(2,'0')}T00:00:00Z`,year:'2026'}));
let state = {albums,groups:[{id:'campus',name:'校园活动',kind:'manual',projectIds:albums.slice(0,9).map(a=>a.id),rule:{},symbol:'image',layout:'stack',color:'#515c67',tint:'#e6e9ec'},
 {id:'other',name:'另一个相册集',kind:'manual',projectIds:[],rule:{},symbol:'grid',layout:'stack',color:'#515c67',tint:'#e6e9ec'}],
 preferences:{pins:['album:1','group:campus'],recentItems:[{id:2,visitedAt:Date.now()}],colors:{},dismissed:[]},workspaceRevision:1,userRevision:1,canOrganize:true};
const calls=[];
const server=http.createServer((req,res)=>{
 const requested=new URL(req.url,'http://localhost').pathname;
 const file=path.join(root,requested==='/' ? 'index.html' : requested);
 const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(root,'index.html');
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
 res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));
});

async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('mamage_jwt_token','isolated-ui-test');localStorage.setItem('mamage-entry-pref','public');});
  await page.route('https://desktop.test/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#adbdb0"/></svg>'}));
  await page.route('**/api/**',async route=>{
   const req=route.request();const parsed=new URL(req.url());const endpoint=parsed.pathname;
   let data={};let status=200;
   if(endpoint==='/api/users/me')data={id:999,name:'测试账号',organizationName:'测试学院',role:'superadmin',permissions:['photos.view','projects.create','projects.update','ai.generate']};
   else if(endpoint==='/api/workspaces')data={enabled:true,activeUnitId:10,units:[{id:10,name:'测试组织'}]};
   else if(endpoint==='/api/album-desktop' && req.method()==='GET')data=copy(state);
   else if(endpoint==='/api/album-desktop/state' && req.method()==='PUT'){
    const body=req.postDataJSON();calls.push(body);
    if((body.groups&&body.workspaceRevision!==state.workspaceRevision)||(body.preferences&&body.userRevision!==state.userRevision)){status=409;data={message:'其他页面已修改，请重新加载'};}
    else{if(body.groups){state.groups=body.groups;state.workspaceRevision++;}if(body.preferences){state.preferences=body.preferences;state.userRevision++;}data={workspaceRevision:state.workspaceRevision,userRevision:state.userRevision};}
   }else if(endpoint==='/api/projects/list')data={list:albums.map(a=>({id:a.id,projectName:a.name,photoCount:a.count,coverThumbUrl:a.image,createdAt:a.createdAt,updatedAt:a.updatedAt,previewImages:[{thumbUrl:a.image},{thumbUrl:a.image+'?preview=2'}]})),total:12,page:1,pageSize:24,hasMore:false};
   else if(endpoint==='/api/projects/import-status')data={statuses:{}};
   else if(/^\/api\/projects\/\d+$/.test(endpoint))data={id:Number(endpoint.split('/').at(-1)),projectName:'校园活动',photos:[],photoCount:0};
   else if(endpoint.includes('random'))data={list:[]};
   else if(endpoint.startsWith('/api/network'))data={available:false,candidates:[]};
   else if(req.method()!=='GET')throw new Error('Unexpected write '+req.method()+' '+endpoint);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(url,{waitUntil:'networkidle'});
  await page.locator('.album-desktop').waitFor();
  for(const text of ['我的置顶','最近使用','相册集','最近更新'])assert(await page.locator('.acp-main h2').getByText(text,{exact:true}).count());
  assert.equal(await page.locator('.album-desktop .project-toolbar').count(),0,'desktop must not show library sorting');
  await page.waitForTimeout(450);assert.equal(calls.length,0,'mount must not write shared data');
  await page.screenshot({path:'/tmp/mamage-desktop-desktop.png',fullPage:true});
  const widths=[1440,1180,1024,820,768,600,390,320];
  for(const width of widths){await page.setViewportSize({width,height:1000});await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);if(width===390)await page.screenshot({path:'/tmp/mamage-desktop-mobile.png',fullPage:true});}
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.acp-sidebar').getByRole('button',{name:/^全部相册/}).click();
  const toolbar=page.locator('.album-desktop .project-toolbar');await toolbar.waitFor();
  await toolbar.getByRole('button',{name:/排序/}).click();await page.getByRole('menuitemradio',{name:'最早创建的相册',exact:true}).click();
  assert.match(await toolbar.getByRole('button',{name:/排序/}).textContent(),/最早创建/);
  await toolbar.getByRole('button',{name:/时间/}).click();
  await page.locator('input[aria-label="开始日期"]').fill('2027-01-01');
  assert.equal(await page.locator('.desktop-album').count(),0,'library date range must filter albums');
  await page.locator('.acp-sidebar').getByRole('button',{name:'我的桌面',exact:true}).click();
  assert.equal(await page.locator('.album-desktop .project-toolbar').count(),0);
  assert.equal(await page.locator('[data-desktop-section="updates"] .desktop-album').count(),6,'library date range must not filter desktop updates');
  await page.locator('.acp-sidebar').getByRole('button',{name:/^全部相册/}).click();
  await toolbar.locator('.lg-popover-clear').click();
  await page.locator('.acp-sidebar').getByRole('button',{name:'我的桌面',exact:true}).click();
  const group=page.locator('.acp-all-collections > .acp-collection').first();
  assert.equal(await group.locator('.acp-fan-cover').count(),9);
  await group.locator('.acp-fan-stage').hover();await page.waitForTimeout(300);assert((await group.getAttribute('class')).includes('is-expanded'));
  await page.mouse.move(0,0);
  await page.getByRole('button',{name:'新建相册集',exact:true}).click();
  const modal=page.getByRole('dialog').last();await modal.locator('input').fill('新相册集');await modal.getByRole('button',{name:'创建相册集',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
  await page.waitForTimeout(500);assert(state.groups.some(g=>g.name==='新相册集'));
  await page.reload({waitUntil:'networkidle'});await page.locator('.album-desktop').waitFor();assert(await page.locator('.acp-sidebar').getByText('新相册集',{exact:true}).count());
  const beforeJump=page.url();await page.locator('.acp-sidebar').getByRole('button',{name:'最近更新',exact:true}).click();assert.equal(page.url(),beforeJump);
  await page.waitForTimeout(500);assert(await page.locator('[data-desktop-section="updates"] .acp-section-spotlight').count());
  await page.locator('.acp-sidebar').getByRole('button',{name:/^全部相册/}).click();
  const first=page.locator('.desktop-album[data-album-id="12"]');await first.locator('.desktop-album-menu-trigger').click();await page.getByRole('menuitemcheckbox',{name:'置顶相册',exact:true}).click();await page.waitForTimeout(500);
  assert(state.preferences.pins.includes('album:12'));
  await page.locator('.acp-sidebar').getByRole('button',{name:'我的桌面',exact:true}).click();
  const collection=page.locator('.acp-all-collections > .acp-collection').first();
  await collection.getByRole('button',{name:'更多操作 校园活动',exact:true}).click();await collection.getByRole('menuitem',{name:'调整外观 校园活动'}).click();
  const colorModal=page.getByRole('dialog').last();await colorModal.locator('input[type="color"]').fill('#ddeeff');await colorModal.getByRole('button',{name:'保存外观',exact:true}).click();await page.waitForTimeout(500);
  assert.equal(state.preferences.colors.campus,'#ddeeff');
  await page.reload({waitUntil:'networkidle'});await page.locator('.album-desktop').waitFor();assert((await page.locator('.acp-all-collections > .acp-collection').first().getAttribute('style')).includes('#ddeeff'));
  await page.locator('.acp-sidebar').getByRole('button',{name:/^全部相册/}).click();
  await page.locator('.desktop-album[data-album-id="12"]').dragTo(page.locator('.acp-sidebar').getByRole('button',{name:/^另一个相册集/}));
  await page.getByRole('dialog').last().getByRole('button',{name:'确认加入',exact:true}).click();await page.waitForTimeout(500);
  assert(state.groups.find(g=>g.id==='other').projectIds.includes(12));
  await page.locator('.desktop-album[data-album-id="12"]').locator('.project-card__open').click();await page.waitForURL(/projectId=12/);await page.waitForTimeout(100);assert.equal(state.preferences.recentItems[0].id,12);
  state.canOrganize=false;await page.goto(url,{waitUntil:'networkidle'});await page.locator('.album-desktop').waitFor();
  assert.equal(await page.getByRole('button',{name:'新建相册集',exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});await page.locator('.desktop-directory-trigger').click();await page.getByRole('dialog').waitFor();assert(await page.getByRole('dialog').getByRole('navigation',{name:'相册目录'}).count());
  state.canOrganize=true;state.preferences={pins:[],recentItems:[],colors:{},dismissed:[]};
  await page.goto(url,{waitUntil:'networkidle'});await page.locator('.album-desktop').waitFor();
  const checkPersonalSections=async(pins,usage)=>{
   assert.equal(await page.locator('[data-desktop-section="pins"]').count(),Number(pins));
   assert.equal(await page.locator('[data-desktop-section="usage"]').count(),Number(usage));
   assert.equal(await page.locator('.acp-sidebar').getByRole('button',{name:'我的置顶',exact:true}).count(),Number(pins));
   assert.equal(await page.locator('.acp-sidebar').getByRole('button',{name:'最近使用',exact:true}).count(),Number(usage));
  };
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await checkPersonalSections(false,false);await page.screenshot({path:`/tmp/mamage-desktop-empty-${width}.png`,fullPage:true});}
  await page.locator('.desktop-directory-trigger').click();
  const directory=page.getByRole('dialog');
  assert.equal(await directory.getByRole('button',{name:'我的置顶',exact:true}).count(),0);
  assert.equal(await directory.getByRole('button',{name:'最近使用',exact:true}).count(),0);
  await directory.getByRole('button',{name:'关闭',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'管理我的置顶',exact:true}).click();
  const pinDialog=page.getByRole('dialog');
  await pinDialog.locator('label').filter({has:page.getByText('校园活动 1',{exact:true})}).click();
  await checkPersonalSections(true,false);
  await pinDialog.getByRole('button',{name:'取消置顶项目 1',exact:true}).click();
  await checkPersonalSections(false,false);
  await pinDialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('.desktop-album[data-album-id="12"] .project-card__open').click();
  await page.waitForURL(/projectId=12/);await page.waitForTimeout(100);
  await page.goto(url,{waitUntil:'networkidle'});await page.locator('.album-desktop').waitFor();await checkPersonalSections(false,true);
  state.preferences={pins:['album:999','group:missing'],recentItems:[{id:999,visitedAt:Date.now()}],colors:{},dismissed:[]};
  await page.reload({waitUntil:'networkidle'});await page.locator('.album-desktop').waitFor();await checkPersonalSections(false,false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({productionApp:true,fixtureOnly:true,widths,sections:true,fanLimit:9,persistence:true,pin:true,personalColor:true,dropConfirmation:true,visit:true,emptySectionsHidden:true,personalSectionsReappear:true,staleItemsHidden:true,libraryOnlySorting:true,libraryOnlyDateRange:true,errors}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1});

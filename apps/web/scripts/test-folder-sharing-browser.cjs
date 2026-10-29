const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const dist = process.env.MAMAGE_FOLDER_SHARE_QA_DIST || path.resolve(__dirname, '../dist');
const artifacts = process.env.MAMAGE_FOLDER_SHARE_QA_DIR;
(async () => {
  const statusModule = {exports:{}};
  const transformed = require('@babel/core').transformFileSync(path.join(__dirname,'../src/utils/sharingStatus.js'),{presets:[require.resolve('@babel/preset-env')]}).code;
  new Function('module','exports',transformed)(statusModule,statusModule.exports);
  const {sharingStatusText,cardSharingStatus,cardSharingLabel}=statusModule.exports;
  assert.equal(sharingStatusText(null),'');assert.equal(sharingStatusText({direction:'copy'}),'');
  assert.equal(sharingStatusText({direction:'sent',targetUnitNames:['部门','部门'],public:true}),'已共享至 部门 · 实时共享 · 公开分享已开启');
  assert.equal(sharingStatusText({direction:'sent',public:true}),'公开分享已开启');
  assert.equal(sharingStatusText({direction:'received',originLabel:'来源',mode:'collaborate'}),'来自 来源 · 共同编辑 · 实时共享');
  assert.equal(cardSharingStatus({sharing:null,isShared:true,originLabel:'旧来源'}),null,'Explicit refreshed null must not revive a stale status');
  assert.equal(cardSharingLabel({direction:'sent',targetUnitNames:['部门']}),'已共享');
  assert.equal(cardSharingLabel({direction:'sent',public:true}),'公开外链');
  assert.equal(cardSharingLabel({direction:'sent',targetUnitNames:['部门'],public:true}),'共享 · 外链');
  assert.equal(cardSharingLabel({direction:'received',originLabel:'来源',mode:'collaborate'}),'协作共享');
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#61988c' } }).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(), cases = [];
  try {
    for (const style of ['glass', 'classic']) for (const width of [1440, 390]) {
      if(process.env.MAMAGE_FOLDER_SHARE_QA_CASE && process.env.MAMAGE_FOLDER_SHARE_QA_CASE!==`${style}-${width}`)continue;
      const context = await browser.newContext({ viewport: { width, height: 980 } });
      try {
        await context.addInitScript(style => { localStorage.setItem('mamage_jwt_token', 'isolated-folder-sharing-fixture'); localStorage.setItem('mamage-folder-style:v1:7', style); }, style);
        await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}}));
        const errors = [], posts = [], unexpected = [];
        const photo = { id: 1001, projectId: 76, type: 'normal', url: '/api/image/fixture.jpg', thumbUrl: '/api/image/fixture.jpg', title: '原片', photographerId: 7, aiStatus: 'done' };
        const albums = [76,77,78].map((id, i) => ({ id, name: ['原相册','子层相册','未共享相册'][i], title: ['原相册','子层相册','未共享相册'][i],
          count: 1, unitId: 1, createdAt: '2026-10-01', updatedAt: '2026-10-22', image: '/api/image/fixture.jpg', canEdit: true }));
        const groups = [{ id:'root', name:'测试共享文件夹', kind:'manual', parentId:null, projectIds:[76,78], createdBy:7, canEdit:true, color:'#516575', tint:'#e3ecef' },
          { id:'child', name:'子文件夹', kind:'manual', parentId:'root', projectIds:[77], createdBy:7, canEdit:true }];
        const received = { id:6, folderId:'root', albumName:'收到的文件夹', mode:'read', albumCount:2, originLabel:'学院 / 来源部门' };
        const sharedData = { share: received, groups, albums: albums.slice(0,2).map(a => ({ ...a, isShared:true,originLabel:'学院 / 来源部门',shareMode:'read',groups: groups.filter(g => g.projectIds.includes(a.id)).map(g => g.id) })) };
        let created = false, sharingVisible = true, desktopReads = 0, statusReads = 0;
        const sentStatus = {direction:'sent',targetUnitNames:['接收部门','另一个名称比较长的部门'],public:true};
        await context.route('**/api/**', async route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          if (/\/sharing-status$|\/folder-shares\/status\//.test(p)) statusReads++;
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType:'image/jpeg', body:image });
          if (req.method() === 'POST') {
            posts.push({ p, body:req.postDataJSON() });
            if (p === '/api/folder-shares') { created = true; return route.fulfill({ json:{ id:10, code:'folder-public' } }); }
            unexpected.push(p); return route.abort();
          }
          if (!['GET','HEAD','OPTIONS'].includes(req.method())) { unexpected.push(p); return route.abort(); }
          let data = {};
          if (p === '/api/users/me') data = { id:7, role:'admin', name:'验收', activeUnitId:1, metadataEditScope:'unit', permissions:['projects.view','photos.view','projects.update','upload.photo','photos.edit','photos.zip'] };
          else if (p === '/api/workspaces') data = { enabled:true, activeUnitId:1, units:[{id:1,name:'测试部门',role:'manager'}], shareTargets:[{id:1,name:'测试部门'},{id:2,name:'接收部门'}] };
          else if (p === '/api/album-desktop') { desktopReads++; data = { albums, groups, sharedAlbums:[], sharedFolders:[received], preferences:{pins:['group:root','album:76'],recentItems:[],colors:{},dismissed:[]},
            sharingStatuses:sharingVisible ? {albums:{76:sentStatus,77:{direction:'received',originLabel:'学院 / 来源部门',mode:'read'}},folders:{root:sentStatus,child:sentStatus}} : {albums:{},folders:{}},
            scope:{userId:7,organizationId:2,unitId:1}, workspaceRevision:1,userRevision:1,canOrganize:true,canDeleteFolders:true }; }
          else if (p === '/api/projects/list') data = { list:albums,total:albums.length,hasMore:false };
          else if (p === '/api/projects') data = albums;
          else if (p === '/api/projects/import-status') data = {statuses:{}};
          else if (/^\/api\/projects\/\d+\/sharing-status$/.test(p)) data = {sharing:p.includes('/78/') ? null : {direction:'received',originLabel:'学院 / 来源部门',mode:'collaborate'}};
          else if (/^\/api\/projects\/\d+\/previews$/.test(p)) data = {list:[photo]};
          else if (/^\/api\/projects\/\d+$/.test(p)) data = {...albums.find(a=>a.id===Number(p.split('/').at(-1))),projectName:albums.find(a=>a.id===Number(p.split('/').at(-1)))?.name,photos:[photo]};
          else if (p === '/api/folder-shares/6') data = sharedData;
          else if (p.startsWith('/api/folder-shares/status/')) data = {sharing:created ? {direction:'sent',targetUnitNames:['接收部门']} : null};
          else if (p === '/api/folder-shares/sent') data = created ? [{id:10,folderId:'root',shareType:'folder',mode:'read',albumName:groups[0].name,targetUnitName:'接收部门'}] : [];
          else if (p === '/api/folder-shares/received') data = [received];
          else if (p === '/api/internal-shares/sent' || p === '/api/internal-shares/received' || p === '/api/share/mine') data = [];
          else if (p.includes('/recipients')) data = [{id:67,name:'接收同学'}];
          else if (p === '/api/share/folder-public') data = url.searchParams.has('projectId')
            ? {code:'folder-public',shareCode:'folder-public',shareType:'project',projectId:76,title:'公开相册',photos:[photo],limit:100}
            : {code:'folder-public',shareCode:'folder-public',shareType:'folder',title:'公开文件夹',photos:[],folder:{...sharedData,public:true}};
          return route.fulfill({ json:data });
        });
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base);
        const folderBadge = () => style==='glass'
          ? page.locator('.acp-collection[aria-label="测试共享文件夹"] .acp-collection-caption.is-visible .card-sharing-status')
          : page.getByRole('button',{name:'浏览文件夹 测试共享文件夹',exact:true}).locator('.card-sharing-status');
        await folderBadge().waitFor();assert.match(await folderBadge().getAttribute('title'),/已共享至 接收部门、另一个名称比较长的部门.*实时共享.*公开分享已开启/);
        if (style === 'glass' && width === 1440) {
          const directory = page.getByRole('navigation', { name: '相册目录' });
          const tree = directory.getByRole('list', { name: '多级文件夹' });
          await tree.locator('.acp-folder-link').filter({ hasText: '测试共享文件夹' }).waitFor();
          assert.equal(await directory.getByRole('heading', { name: '文件夹', exact: true }).count(), 0);
          assert.equal(await directory.getByRole('button', { name: '文件夹', exact: true }).count(), 0);
          assert.equal(await directory.getByRole('button', { name: '新建目录文件夹' }).count(), 1);
          const collapse = directory.getByRole('button', { name: '收起小组空间' });
          await collapse.click();
          assert.equal(await tree.isVisible(), false);
          const unfiled = directory.getByRole('button', { name: /未归类/ });
          assert.equal(await unfiled.isVisible(), true);
          await unfiled.click();
          await page.getByRole('heading', { name: /未归类/, level: 1 }).waitFor();
          await directory.getByRole('button', { name: '小组空间', exact: true }).click();
          await directory.getByRole('button', { name: '展开小组空间' }).click();
          assert.equal(await tree.isVisible(), true);
          await directory.getByRole('button', { name: '展开 测试共享文件夹' }).click();
          assert.equal(await tree.locator('.acp-folder-link').filter({ hasText: '子文件夹' }).isVisible(), true);
        }
        if (style === 'glass' && width === 390) {
          await page.getByRole('button', { name: '打开相册目录' }).click();
          const directory = page.getByRole('navigation', { name: '相册目录' });
          const tree = directory.getByRole('list', { name: '多级文件夹' });
          await tree.waitFor();
          await directory.getByRole('button', { name: '收起小组空间' }).click();
          assert.equal(await tree.isVisible(), false);
          assert.equal(await directory.getByRole('button', { name: /未归类/ }).isVisible(), true);
          await directory.getByRole('button', { name: '展开小组空间' }).click();
          assert.equal(await tree.isVisible(), true);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.keyboard.press('Escape');
        }
        assert.equal(statusReads,0,'Home cards must not request status individually');
        const pinBadge = style==='glass' ? page.locator('.acp-shortcut').filter({has:page.getByRole('button',{name:'打开文件夹 测试共享文件夹',exact:true})}).locator('.card-sharing-status')
          : page.getByRole('button',{name:'打开置顶 测试共享文件夹',exact:true}).locator('.card-sharing-status');
        await pinBadge.waitFor();
        for(const badge of [folderBadge(),pinBadge])assert.ok(await badge.evaluate(node=>{const b=node.getBoundingClientRect(),p=node.parentElement.getBoundingClientRect();return b.left>=p.left-1&&b.right<=p.right+1&&b.top>=p.top-1&&b.bottom<=p.bottom+1}),'Sharing status stays inside its text area');
        sharingVisible=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
        await folderBadge().waitFor({state:'detached'});assert.ok(desktopReads>=2,'Sharing statuses refresh as one batch');
        assert.equal(posts.length,0,'Refreshing display-only status must not persist desktop state');
        sharingVisible=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await folderBadge().waitFor();
        if(style==='glass') {
          const card=page.locator('.acp-collection[aria-label="测试共享文件夹"]');await card.waitFor();
          await card.locator('.acp-fan-stage').hover({position:{x:80,y:30}});
          await page.waitForFunction(()=>document.querySelector('.acp-collection[aria-label="测试共享文件夹"]')?.classList.contains('is-expanded'));
          const label=card.locator('.acp-collection-label');await label.hover();
          await page.waitForFunction(()=>!document.querySelector('.acp-collection[aria-label="测试共享文件夹"]')?.classList.contains('is-expanded'));
          // Click in place, without moving to a distant blank area or chasing a moving caption.
          await page.mouse.down();await page.mouse.up();await page.waitForURL(url=>url.searchParams.get('folder')==='root');
          assert.equal(new URL(page.url()).searchParams.has('projectId'),false);
          await page.goto(base);
          for(let attempt=0;attempt<3;attempt++){
            const zoom=width===1440 ? [1,0.8,1.25][attempt] : 1;
            await page.evaluate(value=>document.documentElement.style.zoom=String(value),zoom);
            await page.getByRole('button',{name:'更多操作 测试共享文件夹',exact:true}).click();
            await page.getByRole('menuitem',{name:'共享文件夹',exact:true}).waitFor();
            const menu=page.getByRole('menu',{name:'文件夹操作 测试共享文件夹',exact:true});
            const metrics=await menu.evaluate(element=>({width:element.getBoundingClientRect().width,rows:[...element.querySelectorAll('button')].map(button=>({height:button.getBoundingClientRect().height,iconWidth:button.querySelector('svg').getBoundingClientRect().width,iconHeight:button.querySelector('svg').getBoundingClientRect().height,labelHeight:button.querySelector('span').getBoundingClientRect().height}))}));
            if(artifacts && attempt===0){await page.screenshot({path:path.join(artifacts,`folder-menu-${style}-${width}.png`),animations:'disabled'});fs.writeFileSync(path.join(artifacts,`folder-menu-${style}-${width}.json`),JSON.stringify(metrics,null,2));}
            assert.ok(metrics.width<=200*zoom,JSON.stringify(metrics));
            assert.ok(metrics.rows.every(row=>row.height<=46*zoom&&row.iconWidth<=20*zoom&&row.iconHeight<=20*zoom&&row.labelHeight<=20*zoom),'Folder menu must have compact single-line items: '+JSON.stringify(metrics));
            await page.keyboard.press('Escape');
          }
          await page.evaluate(()=>document.documentElement.style.zoom='1');
          await page.getByRole('button',{name:'更多操作 测试共享文件夹',exact:true}).click();
        } else await page.getByRole('button',{name:'文件操作 测试共享文件夹',exact:true}).click();
        await page.getByRole('menuitem',{name:'共享文件夹',exact:true}).click();
        const dialog=page.getByRole('dialog');await dialog.waitFor();assert.ok((await dialog.innerText()).includes('分享文件夹'));
        assert.equal(new URL(page.url()).searchParams.has('folder'),false,'Sharing is available from the parent card');
        for(const name of ['只读','可复制','共同编辑']) assert.equal(await dialog.getByRole('button',{name,exact:true}).count(),1);
        await dialog.getByRole('button',{name:'接收部门',exact:true}).click();await page.getByRole('option',{name:'接收部门',exact:true}).click();
        await dialog.getByRole('button',{name:'分享给部门',exact:true}).click();
        await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some(tab => tab.textContent === '部门记录' && tab.getAttribute('aria-selected') === 'true'));
        assert.equal(posts[0].body.folderId,'root');assert.equal(posts[0].body.shareType,'folder');
        await dialog.getByRole('tab',{name:'公开分享',exact:true}).click();await dialog.getByRole('button',{name:'创建外链',exact:true}).click();
        await dialog.getByRole('button',{name:'创建外链',exact:true}).waitFor();
        await page.waitForFunction(()=>!document.querySelector('.workspace-album-public-form button.mamage-button')?.disabled);
        assert.ok(posts.some(post=>post.body.mode==='public'&&post.body.folderId==='root'));
        if(artifacts)await page.screenshot({path:path.join(artifacts,`sharing-${style}-${width}.png`)});
        await page.goto(base+'/?folder=root');
        const albumBadge = style==='glass' ? page.locator('.desktop-album').filter({has:page.getByRole('button',{name:'进入相册 原相册',exact:true})}).locator('.project-card__sharing')
          : page.getByRole('button',{name:'预览相册 原相册',exact:true}).locator('.card-sharing-status');
        await albumBadge.waitFor();assert.match(await albumBadge.getAttribute('title'),/已共享至.*公开分享已开启/);assert.equal(await albumBadge.innerText(),'共享 · 外链');
        const unsharedCard = style==='glass' ? page.locator('.desktop-album').filter({has:page.getByRole('button',{name:'进入相册 未共享相册',exact:true})})
          : page.getByRole('button',{name:'预览相册 未共享相册',exact:true});
        await unsharedCard.waitFor();assert.equal(await unsharedCard.locator('.card-sharing-status').count(),0);
        const childBadge = style==='glass' ? page.locator('.acp-collection[aria-label="子文件夹"] .acp-collection-caption.is-visible .card-sharing-status')
          : page.getByRole('button',{name:'浏览文件夹 子文件夹',exact:true}).locator('.card-sharing-status');
        await childBadge.waitFor();
        if(artifacts)await page.screenshot({path:path.join(artifacts,`card-status-${style}-${width}.png`),animations:'disabled'});
        await page.getByRole('button',{name:style==='glass'?'更多操作 原相册':'文件操作 原相册',exact:true}).click();
        await page.getByRole('menuitem',{name:'共享相册',exact:true}).click();
        assert.ok((await page.getByRole('dialog').innerText()).includes('分享相册'));
        assert.equal(new URL(page.url()).searchParams.has('projectId'),false,'Sharing an album does not first open it');
        await page.goto(base+'/?projectId=76');await page.getByRole('status',{name:'相册共享状态'}).waitFor();
        assert.match(await page.getByRole('status',{name:'相册共享状态'}).innerText(),/学院 \/ 来源部门.*共同编辑.*实时共享/);
        await page.goto(base+'/?projectId=78');await page.locator('.detail-photo-item').first().waitFor();
        assert.equal(await page.getByRole('status',{name:'相册共享状态'}).count(),0);
        await page.goto(base+'/?sharedFolder=6');await page.getByRole('region',{name:'共享文件夹内容'}).waitFor();
        assert.ok((await page.getByRole('region',{name:'共享文件夹内容'}).innerText()).includes('学院 / 来源部门'));
        if(style==='glass')await page.getByRole('button',{name:'打开文件夹 子文件夹',exact:true}).click();
        else await page.locator('.shared-folder-row').filter({hasText:'子文件夹'}).click();
        assert.ok((await page.getByRole('region',{name:'共享文件夹内容'}).innerText()).includes('子层相册'));
        await page.evaluate(()=>localStorage.removeItem('mamage_jwt_token'));
        await page.goto(base+'/share/folder-public');await page.getByRole('region',{name:'共享文件夹内容'}).waitFor();
        await page.locator('.project-card__open').first().click();await page.getByRole('heading',{name:'公开相册',exact:true}).waitFor();
        assert.equal(await page.locator('.share-photo').count(),1);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile overflow');
        assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
        cases.push({style,width,parentCardSharing:true,folderModes:4,sharedStatus:true,unsharedHidden:true,liveFolderBrowse:true,publicFolderBrowse:true,captionClosesFan:style==='glass',cardStatus:true,pinnedCardStatus:true,batchRefresh:true,noStatusPersistence:true});
      }catch(error){
        if(artifacts && context.pages()[0]) await context.pages()[0].screenshot({path:path.join(artifacts,`failure-${style}-${width}.png`),fullPage:true}).catch(()=>{});
        throw error;
      }finally{await context.close();}
    }
    if(artifacts)fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify({passed:true,cases},null,2));
    console.log(JSON.stringify({passed:true,cases}));
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

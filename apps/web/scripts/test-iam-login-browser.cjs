const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const dist = path.resolve(__dirname, '../dist'), artifacts = process.env.MAMAGE_IAM_QA_DIR;
const fixtures = [{name:'password',iam:false,dingtalk:false},{name:'campus',iam:true,dingtalk:false},{name:'dingtalk',iam:false,dingtalk:true}];
async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [1440,390,320]) for (const provider of fixtures) {
      const context = await browser.newContext({ viewport: { width, height: 860 } });
      try {
        const errors=[],writes=[];
        await context.route('**/api/**', async route => {
          const req=route.request(),url=new URL(req.url());
          if(url.pathname==='/api/auth/iam/login'||url.pathname==='/api/auth/dingtalk/login') {
            if(provider.iam) assert.equal(url.searchParams.get('returnTo'),'/?projectId=102&upload=1');
            return route.fulfill({contentType:'text/plain',body:'Isolated authorization fixture'});
          }
          if(req.method()!=='GET') {
            writes.push({url:url.pathname,body:req.postDataJSON()});
            assert.equal(url.pathname,'/api/users/login');
            return route.fulfill({status:401,json:{error:'invalid credentials'}});
          }
          if(url.pathname==='/api/auth/providers') return route.fulfill({json:{password:true,...provider}});
          return route.fulfill({json:[]});
        });
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base+'/?projectId=102&upload=1');
        await page.locator('.auth-provider-loading').waitFor({state:'hidden'});
        await page.getByRole('heading',{name:'登录 MaMage',exact:true}).waitFor();
        const sso=provider.iam||provider.dingtalk;
        if(sso) {
          const campusTab=page.getByRole('tab',{name:provider.iam?'校园登录':'钉钉登录',exact:true});
          assert.equal(await campusTab.getAttribute('aria-selected'),'true');
          assert.equal(await page.locator('input[type="password"]').count(),0);
          assert.equal(await page.locator('.auth-content iframe,.auth-content canvas').count(),0,'no fake QR or unconfigured frame');
          if(artifacts) await page.screenshot({path:path.join(artifacts,`login-${provider.name}-${width}.png`),fullPage:true});
          await campusTab.focus();await campusTab.press('ArrowRight');
          assert.equal(await page.getByRole('tab',{name:'账号密码',exact:true}).getAttribute('aria-selected'),'true');
        }
        await page.getByRole('button',{name:'登录',exact:true}).click();
        await page.getByText('请输入邮箱或学号',{exact:true}).waitFor();
        assert.equal(writes.length,0);
        await page.getByRole('textbox',{name:'邮箱或学号',exact:true}).fill('fixture@example.edu');
        await page.getByLabel('密码',{exact:true}).fill('Synthetic123');
        await page.getByLabel('密码',{exact:true}).press('Enter');
        await page.getByText('邮箱或密码错误',{exact:true}).waitFor();
        assert.deepEqual(writes,[{url:'/api/users/login',body:{email:'fixture@example.edu',password:'Synthetic123'}}]);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);
        assert.equal(await page.locator('.auth-product-mark').evaluate(img=>img.complete&&img.naturalWidth>0),true);
        if(artifacts) await page.screenshot({path:path.join(artifacts,`password-${provider.name}-${width}.png`),fullPage:true});
        await page.getByRole('button',{name:'创建账号',exact:true}).click();
        await page.getByRole('heading',{name:'创建 MaMage 账号',exact:true}).waitFor();
        await page.getByPlaceholder('姓名',{exact:true}).fill('Fixture');
        assert.ok(await page.getByText('组织代号',{exact:true}).isVisible());
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        if(artifacts&&width===390&&provider.iam) await page.screenshot({path:path.join(artifacts,'register-390.png'),fullPage:true});
        await page.getByRole('button',{name:'返回登录',exact:true}).click();
        if(sso) {
          await page.getByRole('tab',{name:provider.iam?'校园登录':'钉钉登录',exact:true}).click();
          await page.getByRole('button',{name:provider.iam?'前往校园登录':'使用钉钉登录',exact:true}).click();
          await page.getByText('Isolated authorization fixture',{exact:true}).waitFor();
          await page.goBack();
          const retry=page.getByRole('button',{name:provider.iam?'前往校园登录':'使用钉钉登录',exact:true});
          await retry.waitFor();assert.equal(await retry.isEnabled(),true,'returning from authorization does not leave a disabled button');
        }
        assert.deepEqual(errors,[]);
      } finally {await context.close();}
    }
    const mobile=await browser.newContext({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 DingTalk/7.0'});
    try {
      let starts=0;
      await mobile.route('**/api/**',async route=>{
        const url=new URL(route.request().url());
        if(url.pathname==='/api/auth/providers') return route.fulfill({json:{password:true,iam:true,dingtalk:false}});
        if(url.pathname==='/api/auth/iam/login') {starts++;return route.fulfill({contentType:'text/plain',body:'Container authorization fixture'});}
        return route.fulfill({json:[]});
      });
      const page=await mobile.newPage();await page.goto(base+'/');
      await page.getByText('Container authorization fixture',{exact:true}).waitFor();assert.equal(starts,1);
      await page.goto(base+'/#iam_error=IAM_LOGIN_UNAVAILABLE');
      await page.locator('.auth-notice').waitFor();await page.locator('.auth-provider-loading').waitFor({state:'hidden'});
      assert.equal(starts,1,'failure must not create an automatic redirect loop');
      await page.getByRole('tab',{name:'账号密码',exact:true}).click();await page.getByLabel('密码',{exact:true}).waitFor();
    }finally{await mobile.close();}
    const failed=await browser.newContext();
    try {
      await failed.route('**/api/**',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
      const page=await failed.newPage();await page.goto(base+'/');
      await page.getByText('校园登录暂不可用',{exact:true}).waitFor();await page.getByLabel('密码',{exact:true}).waitFor();
    }finally{await failed.close();}
    console.log('Login browser checks passed: three providers, desktop/mobile/narrow screens, keyboard/password errors, registration, redirects, container auto-entry and failure fallback.');
  }finally{if(browser) await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

# 在登录页嵌入学校 IAM 二维码（接入指南）

> 适用对象：要自己实现「钉钉扫一扫登录」的前端/后端同学。
> 参考实现：`apps/server/lib/iam_qr_gateway.js`、`apps/server/routes/iam_qr.js`、`apps/web/src/CampusLoginQr.jsx`。
> 说明：这是 IAM 登录页自己的内部接口，**不在芯盾的产品对接文档里**。如果学校升级 IAM 改了接口，需要按新版本调整；不想维护的话，直接用「跳转授权页」的方式更稳。

---

## 一、先搞清楚这条链路在做什么

```
你的页面                     你的后端                    学校 IAM (idaas.bza.edu.cn)
  │                            │                              │
  │ POST /qr (你自己造的接口)   │                              │
  ├───────────────────────────>│ 1. 构造 OAuth 授权 URL        │
  │                            ├─ GET authorize ─────────────>│ 302 → /sso/login
  │                            ├─ GET /sso/login ────────────>│ 302 → /authn/index.html?service=…
  │                            │   （这一串 302 会下发会话 Cookie，必须保存）│
  │                            ├─ POST /authn/api/idp/init ──>│ 返回 challengeId/contextRaw/actions
  │                            ├─ POST …/idp/preAuth ────────>│ 返回二维码图片地址
  │                            ├─ GET  二维码图片 ───────────>│ 返回 PNG/JPG
  │<── 图片地址 + 轮询 id ──────┤                              │
  │ 展示二维码                  │                              │
  │                            │ 2. 轮询 listening（长轮询）   │
  │ POST /status (每 1.5s)      ├─ POST …/idp/listening ─────>│ 2007=等待，1000=已扫
  │                            │                              │
  │ 用户用手机钉钉扫码 ─────────────────────────────────────────>│ 手机确认
  │                            │<── 1000 + issue[IAM_TICKET] ─┤ 带一次性 go 地址
  │<── 告诉前端"已确认" ─────────┤                              │
  │ 浏览器跳转 go 地址 ───────────────────────────────────────>│ 校验票据、建会话
  │                            │<── 302 回你的 redirect_uri?code=…&state=… ──┤
  │                            │ 3. code 换 token、读 profile │
  │<── 你自己的登录态 ───────────┤                              │
```

**关键点：二维码的“状态”在 IAM 侧，且绑定在 `/authn` 的会话 Cookie 上。** 后端必须保存并回传这些 Cookie，否则轮询永远拿不到扫码结果。

---

## 二、前置条件（找 IAM 管理员要）

| 项 | 说明 |
|---|---|
| IAM 地址 | 本校是 `https://idaas.bza.edu.cn` |
| OAuth 应用 | `client_id` / `client_secret`，回调地址必须登记（本校登记的是 `http://10.1.131.37/`） |
| 回调约定 | 授权码回到你的 `redirect_uri`，带 `code` 和 `state` |
| 网络 | 你的**服务器**要能访问 IAM（不是浏览器能访问就行） |
| 协议 | 芯盾 CASOAUTH：`/sso/oauth2.0/authorize` → `/sso/oauth2.0/accessToken` → `/sso/oauth2.0/profile` |

---

## 三、后端实现步骤（Node 示例）

### 1. 造授权 URL

```js
const auth = new URL('https://idaas.bza.edu.cn/sso/oauth2.0/authorize');
for (const [k, v] of Object.entries({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,          // 必须和登记一致
  response_type: 'code',
  state,                                // 一次性，绑定浏览器
})) auth.searchParams.set(k, v);
// 建议加 PKCE
auth.searchParams.set('code_challenge', sha256base64url(verifier));
auth.searchParams.set('code_challenge_method', 'S256');
```

### 2. 跟随 302、把 Cookie 存起来（这一步最容易漏）

```js
const jar = new Map();
const absorb = res => {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';'); const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

let page = auth, res;
for (let i = 0; i < 5; i++) {
  res = await fetch(page, { redirect: 'manual' });
  absorb(res);                              // ← 必须
  const loc = res.headers.get('location');
  if (!loc) break;
  page = new URL(loc, page);
  if (page.pathname === '/authn/index.html') break;
}
// page 现在带着 ?service=…
```

浏览器实际会拿到的 Cookie 名（供排查用）：`DISSESSIONOauthOidcServerSupport`、`XSRF-TOKEN`、`FREQ_DEVICE`。

### 3. init：拿 challenge

```js
const service = page.searchParams.get('service');
const init = await post('/authn/api/idp/init', {
  sp: { type: 'IAM_TICKET', callbackUrl: service },
});
// init.status === 1000
// init.responseBody: { challengeId, contextRaw, actions: [{ id, code: 'qrcode' }, …] }
```

`callbackUrl` 必须是上一步拿到的 **service 全量 URL**，并且里面的 `client_id / redirect_uri / state / code_challenge*` 要与你的授权 URL 完全一致。

### 4. preAuth：拿二维码图片地址

```js
const action = init.responseBody.actions.find(a => a.code === 'qrcode');
const pre = await post('/authn/api/idp/preAuth', {
  challengeId: init.responseBody.challengeId,
  contextRaw: init.responseBody.contextRaw,
  actionId: action.id,
});
// pre.responseBody.param.qrcodeUri 形如 "api/app/qrcode/<token>"
const imageUrl = new URL(pre.responseBody.param.qrcodeUri, page); // 相对 /authn/index.html 解析
```

拉图：

```js
const img = await fetch(imageUrl, { headers: { Cookie: cookieHeader(), Referer: page.href } });
const buf = Buffer.from(await img.arrayBuffer());
// 校验 content-type 是 image/png|image/jpeg，并校验文件头（89504e47 / ffd8ff）
```

> 实测坑：IAM 有时返回 `200 + image/jpeg` 但 **body 0 字节**。必须“内容有效才算成功”，否则重试 2–4 次。

### 5. 轮询 listening

```js
const poll = await post('/authn/api/idp/listening', {
  challengeId, contextRaw,
  ...(crossBrowserId ? { crossBrowserId } : {}),   // 跨设备扫码时 IAM 会下发，原样带回
});
```

| status | 含义 | 处理 |
|---|---|---|
| `2007` | 还在等扫码 | 继续轮询（建议 1.5s 一次，或长轮询 5–15s） |
| `1000` | 已完成 | 读 `responseBody.issue[]`，找 `type === 'IAM_TICKET'` |
| `9044/9045/9046/9074/9075` | 取消/过期/失败 | 停止轮询，提示刷新二维码 |
| `7001` | 会话无效 | **几乎都是没带 Cookie**，回第 2 步检查 |
| `9308/9999` | IAM 侧抖动 | 重试；连续出现要联系 IAM 运维 |

拿到票据后：

```js
const ticket = issues.find(i => i.type === 'IAM_TICKET');
// 安全检查：只接受 https、同源、路径以 /sso/ 开头
const go = new URL(ticket.go);
if (go.origin !== 'https://idaas.bza.edu.cn' || !go.pathname.startsWith('/sso/')) throw new Error('bad ticket');
```

### 6. 交给浏览器

把 `go` 地址返回给前端，前端 `location.assign(go)`。IAM 校验票据后 302 回你的 `redirect_uri?code=…&state=…`，走你原来的 OAuth 回调（校验 state、换 token、读 profile、建自己的会话）。

---

## 四、前端实现要点

```jsx
// 1. 请求你后端的 /qr 接口，拿到 { id, imageUrl, expiresAt }
// 2. 展示 imageUrl（img src），过期时间到了就提示刷新
// 3. 每 1.5s 轮询 /qr/{id}/status
// 4. phase === 'ready' → location.assign(completeUrl)
// 5. 组件卸载 / 用户离开 → 调 /qr/{id}/cancel，别让 IAM 侧悬着
```

时效与并发：

- 二维码建议 **120 秒**过期，过期后必须换新（旧的 challenge 作废）
- 同一浏览器只保留一个有效二维码：新建时把旧的删掉
- 轮询请求不要在页面上并发堆叠（用 setTimeout 串行，而不是 setInterval）

---

## 五、必做安全约束

| 约束 | 原因 |
|---|---|
| 二维码/状态接口只允许**当前浏览器**读（HttpOnly Cookie 绑定） | 否则别人拿到 id 就能劫持登录 |
| 校验请求 `Origin`，只接受你自己的站点 | 防 CSRF |
| `state` 一次性 + 绑定浏览器 Cookie，用完即删 | 防重放 |
| 只允许从 IAM 官方 HTTPS 域名取图，校验证书/类型/大小 | 防 SSRF、防被换成恶意图 |
| 票据 `go` 只允许同源 + `/sso/` 路径 | 防开放重定向 |
| 绝不代理 IAM 的账号密码表单 | 合规与安全底线 |
| 超过 N 次失败就退回「跳转授权页」 | 可用性兜底 |

---

## 六、超时与重试（实测总结）

IAM 的 `init` / `preAuth` 经常出现「要么 20ms 返回，要么一直不回」：

```js
// 单次 3 秒超时，最多 5 次；超时类错误才重试，业务错误不重试
const ATTEMPT_TIMEOUT = 3000, ATTEMPTS = 5;
```

- 取图：`200 + 空 body` 要重试，最多 4 次
- `listening`：用 5–15 秒长轮询；超时当作「还在等」而不是失败
- 整条链路最坏 ~20 秒，前端接口超时给 55 秒

---

## 七、常见现象对照表

| 现象 | 最可能原因 |
|---|---|
| 二维码能出，扫了没反应，最后过期 | `listening` 没带 Cookie（返回 7001）；或缺 `crossBrowserId` |
| 二维码显示空白/破图 | 取图返回 0 字节；或图片地址没按 `/authn/` 解析 |
| 扫码后跳到 IAM 又是登录页 | 票据 `go` 没在**同一个浏览器**里打开；或浏览器没有 IAM 会话 |
| 浏览器回来带 `code` 但登录失败 | 你的回调没校验 state / token 没换到 / profile 里缺字段 |
| 一直「二维码暂不可用」 | `init` 或 `preAuth` 连续失败，看后端日志的 stage |

---

## 八、不想维护这套怎么办

厂商（芯盾）明确表示：**不需要嵌二维码，没登录就跳 OAuth 第一步即可**。

```js
location.href = 'https://idaas.bza.edu.cn/sso/oauth2.0/authorize?client_id=…&redirect_uri=…&response_type=code&state=…';
```

IAM 自己的登录页里就有扫码/密码，登录完回跳你的 `redirect_uri`。这条路径**有产品文档支撑**，升级不受影响，缺点是用户多一次跳转。

---

## 九、自测清单（上线前跑一遍）

- [ ] 断网/超时场景：`init` 超时后能自动重试，最终成功或明确报错
- [ ] 二维码 120 秒后自动提示过期，点刷新能出新码
- [ ] 手机上取消扫码 → 前端 5 秒内变成可刷新状态
- [ ] 换一个浏览器打开同一个 `id`，返回 401
- [ ] 票据 `go` 被篡改成外部域名 → 后端拒绝
- [ ] 回调里 `state` 不匹配 → 拒绝并回到登录页
- [ ] 用户扫码成功但网络断在回跳 → 重新登录能正常完成

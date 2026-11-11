# Keycloak SSO（OIDC）接入说明

MaMage 接学院张小平老师自建的 Keycloak。认证走标准 **OpenID Connect 授权码 + PKCE**，由后端
（`apps/server/routes/auth_oidc.js`）完成授权码兑换、`id_token` 验签与账号解析；前端只拿到本站 JWT，
不接触 Keycloak 的 secret 或 token。

与学校芯盾 IAM（`/api/auth/iam/*`）互相独立、可同时开启：两个身份源用不同的 `source_key`
（`sha256('oidc\n'+issuer+'\n'+client_id)` vs `sha256(base+appId)`），同一 MaMage 账号可各绑一个。

## 一、登录流程

```
浏览器            MaMage 后端                    Keycloak
  │ GET /api/auth/oidc/login?returnTo=…             │
  │───────────────►│ 生成 state/nonce/verifier       │
  │                │ 存共享 store（10 分钟、一次）    │
  │ 302 authorize?…state&nonce&code_challenge=S256  │
  │◄───────────────│                                │
  │─────────────────────────────────────────────────►│ 用户登录
  │ 302 /api/auth/oidc/callback?code&state           │
  │◄─────────────────────────────────────────────────│
  │                │ consume state（Cookie 绑定）     │
  │                │ token 端点换 code（Basic+PKCE）   │
  │                │ JWKS 验签 id_token：iss/aud/     │
  │                │ exp/nonce；userinfo 补资料       │
  │                │ resolveProfile 找账号/自动开户     │
  │                │ 一次性 handoff（2 分钟）          │
  │ 302 /api/auth/oidc/complete#oidc_code=<handoff>   │
  │◄───────────────│                                │
  │ 顶层跳至 /login#oidc_code=<handoff>              │
  │ POST /api/auth/oidc/session  {code}              │
  │（Origin 必须同站，JSON）                          │
  │◄────────────── 本站 JWT + returnTo               │
```

安全点：
- 内嵌模式在兑换 code 前先经同源完成页回到顶层 `/api/auth/oidc/finish`，再执行图中的 Cookie 校验及后续步骤；不在 iframe 内建立本站会话。
- `state` 一次性、与 HttpOnly Cookie（`__Host-mamage_oidc`，内网 http 时降级为站点专用 Cookie）绑定；
- PKCE 强制 S256；`nonce` 绑定到 `id_token`；
- `id_token` 只认 JWKS 中 `kid` 对应密钥，拒绝 `alg=none`；`iss` 精确相等、`aud` 含 `client_id`、多 aud 时校验 `azp`；
- `userinfo.sub` 必须等于已验签 `id_token.sub`；
- `handoff` 不是 JWT：一次性、2 分钟、绑定浏览器 Cookie，前端先清旧 token 再交换；
- 登录后的账号停用/会话版本检查复用 `iam_account_guard`；`requested()` 已把 `OIDC_ENABLED` 纳入，
  单独部署 Keycloak 时也不会绕过停用保护。

## 二、服务端配置

```dotenv
OIDC_ENABLED=1
OIDC_ISSUER=https://<keycloak-host>/realms/<realm>   # 必须与 discovery 的 issuer 完全一致
OIDC_CLIENT_ID=…
OIDC_CLIENT_SECRET=…                                  # 只放服务器 Secret，不入库/不入前端
OIDC_CLIENT_AUTH=client_secret_basic                  # Keycloak 默认
OIDC_SCOPES=openid profile email
OIDC_PROVIDER_LABEL=研究院统一身份认证
OIDC_ORGANIZATION_ID=<本站组织 id>
OIDC_PROFILE_ID_PATH=sub
OIDC_PROFILE_NAME_PATH=name
OIDC_PROFILE_EMAIL_PATH=email
OIDC_PROFILE_STUDENT_PATH=preferred_username          # 默认不用于学工号，需学校提供可信 mapper
OIDC_TRUST_STUDENT_NUMBER=0                           # 确认不可由用户修改的学工号字段后才可开启
OIDC_PROFILE_LOGIN_MATCHING=1
OIDC_AUTO_PROVISION=0
OIDC_CLOCK_SKEW_SECONDS=60
OIDC_AUTO_START=0                                      # 1 = 打开登录页自动跳 IdP（无感 SSO）
OIDC_EMBED_ENABLED=0                                   # 1 = 在本站内嵌官方认证页面，须同时核对 CSP
OIDC_IDP_HINT=                                         # 可选的 Keycloak IdP alias，由服务器固定配置
```

其余可选：`OIDC_AUTO_START`（默认 0；开启后未登录访问会像其他接入应用一样自动跳转 Keycloak，每标签页 2 分钟内只尝试一次，带错误/邀请参数时不跳）、`OIDC_REDIRECT_URI`（默认 `<MAMAGE_PUBLIC_URL>/api/auth/oidc/callback`）、
`OIDC_DISCOVERY_CACHE_SECONDS`、`OIDC_TIMEOUT_MS`、`OIDC_SUBJECT_EMAIL_DOMAIN`。
内网只有 http 时，必须**精确登记** `OIDC_ALLOW_INSECURE_ISSUER_ORIGIN`（IdP 来源）与
`OIDC_ALLOW_INSECURE_HTTP_ORIGIN`（本站入口）——这是有意的内网例外，不支持通配。

### 内嵌研究院钉钉登录

- 研究院这一部署可设置 `OIDC_EMBED_ENABLED=1`、`OIDC_IDP_HINT=dingtalk`。iframe 从本站 `/api/auth/oidc/login?embedded=1` 发起全新的授权码 + PKCE 流程，经 Keycloak、研究院钉钉 broker 跳至官方界面。不截取二维码、不代理认证页 HTML，也不复用旧授权 URL 或 state。
- 顶层页面的 CSP 必须允许 `frame-src 'self' https://sso.inner.bza.edu.cn https://sso-dt.inner.bza.edu.cn https://login.dingtalk.com`；仓库的 Nginx CSP 模板已列出这些精确来源。部署时同步实际入口 Nginx 的 CSP，并保留该入口已有的存储桶 `connect-src` 等配置。不能用通配来源，也不能移除 IdP 的防内嵌安全头。
- 内嵌回调先经 `/api/auth/oidc/complete` 向**同源父窗口**传递授权回跳，再由顶层 `/api/auth/oidc/finish` 携带浏览器 Cookie 校验原 state、PKCE、ID token。确认身份后仍生成原有的一次性 handoff，在顶层换取本站会话。用户绑定、组织、人脸及管理权限均未变更。
- 父窗口同时核对消息的精确 origin、当前 iframe 的 window 引用、消息类型和参数格式。钉钉或其他第三方发来的账号/令牌消息不作为本站登录凭证。
- 认证页面由钉钉控制，可能先显示“账号登录”或已登录头像，可在官方界面中切换“扫码登录”。不伪造扫码/头像状态，不尝试修改跨域页面。官方桌面扫码页不适配过窄的 iframe，低于 480px 时保留整页入口，避免裁掉二维码；钉钉客户端内保留整页免登入口。
- 开启内嵌时普通浏览器不再自动离开本站；账号密码、同页“打开完整登录页”、刷新、9 分钟过期重试均保留。回调失败不会自动重开 iframe。浏览器禁止第三方 Cookie 或 IdP 禁止 iframe 时使用完整登录页。
- 实测 Chromium 禁用第三方 Cookie 时，研究院 Keycloak 返回的错误页受其 `frame-ancestors 'self'` 保护，无法在本站内嵌。这种情况需点完整登录页；跨域 iframe 的 `load` 事件无法可靠区分正常页面与浏览器拦截页，不能声称已自动检测拦截。
- 本地验证：`npm --prefix apps/server run test:oidc`、`npm --prefix apps/web run test:oidc-login`；前端构建后再跑 `npm --prefix apps/web run test:oidc-frame-browser`。实际扫码及对应原账号回归仍须在登记过的回调地址上人工验收。

自检：

```sh
npm --prefix apps/server run oidc:check                 # 只打印脱敏配置与缺失项
npm --prefix apps/server run oidc:check -- --discovery  # 再验证 discovery 可达、issuer 一致
npm --prefix apps/server run oidc:check -- --database   # 再检查 iam_* 表（登录依赖账号保护）
```

## 三、Keycloak 侧需要张老师登记/确认

| 项 | 值/说明 |
| --- | --- |
| Client type / 认证 | OIDC，confidential（Client authentication=ON） |
| Standard flow | ON；Implicit / ROPC / Service accounts 关 |
| PKCE | S256（服务端强制挑战） |
| Valid redirect URIs | `https://<MaMage 站点>/api/auth/oidc/callback`，内网 http 入口另加一条，逐条精确 |
| Valid post logout redirect URIs | `<MaMage 站点>/login`（可选，登出用） |
| Web origins | BFF 模式不直连，一般不用配 |
| Access/ID token lifespan | 建议 5 分钟；服务端按 `exp` 校验并允许 ±60s 时钟偏移 |
| Claims | `sub`（主键）、`preferred_username`、`name`、`email`；学工号/工号请加 User Attribute mapper 并告知键名 |
| groups（可选） | 如需按组映射，请在客户端加 Group Membership mapper 且 **Add to userinfo=ON**；本版不把 groups 当本站角色 |
| 网络 | issuer/token/userinfo/JWKS 必须从 MaMage 服务器可达；授权页必须从用户浏览器可达（仅内网时公网用户用密码登录） |
| 时钟 | 双方 NTP 同步，偏差 >60s 会出现 `OIDC_CLOCK_SKEW` |

> 最大坑：Keycloak 的 `issuer` 由 hostname 配置决定。若对内网用户暴露的域名与对 MaMage 服务器
> 的不一致（如 `sso.lab` vs `10.x.x.x:8080`），`iss` 校验必然失败。请对方确认 issuer 的实际值，
> 并优先参考已接入的 `story.lab.bza.edu.cn` 的同一套配置。

## 四、账号与权限

- `OIDC_PROFILE_LOGIN_MATCHING=0`：最保守，只放行已绑定过的 Keycloak 身份（`iam_login_identities`），
  不做 claim 关联；首次登录会被拒绝（`IAM_ACCOUNT_LINK_REQUIRED`），也不会写待核对队列。
- `OIDC_PROFILE_LOGIN_MATCHING=1`：仅使用已验证邮箱或明确配置为可信的学工号匹配存量账号，并核对姓名；
  可由用户修改的 `preferred_username` 不能作为学工号。未经验证的邮箱与存量账号冲突时进入待核对。
  `OIDC_AUTO_PROVISION=1` 为已获 IdP 授权的新身份建立 `visitor`，不授予小组、管理或人脸权限；
  未分组前只开放账号资料和已有公开分享链接，未经验证的邮箱不写入可用于身份匹配的邮箱字段。
- 第二个 IdP 用邮箱自动关联存量账号存在被冒名风险：接陌生 IdP 时先用 0 做保守模式，等 `sub` 绑定完成后再开 1。
- 首次登录成功写入 `iam_login_identities(source_key, subject_id, user_id)`；之后按 `(source_key, sub)` 找回，
  姓名/邮箱变化不重新绑定。
- 同一账号可同时绑定芯盾与 Keycloak；两个 IdP 的 `source_key` 不同，不会互抢绑定。
- 已知限制：两个身份源都会把 `name/email/student_no` 回写到 `users`，后登录者覆盖；如需严格以某一侧为准，
  需在 `iam_profile_links.syncProfile` 增加来源优先级（尚未实现，见风险清单）。

## 五、“自动化的对接”路线

| 路线 | 说明 | 权限/成本 | 建议 |
| --- | --- | --- | --- |
| A 登录时 provisioning | 按 claims 匹配/开户，登录即同步姓名邮箱 | 0 额外权限 | **先做**（本版已具备） |
| B Admin REST API 拉取 | 独立 service account `client_credentials` + `view-users`/`query-users`/`query-groups`，定时对账、离职停用 | 只读、可审计 | 需要停用/对账时再加 |
| C SCIM | Keycloak 26.7+ preview（`--features=scim-api`），标准入站 | 需对方开启 preview | 对方愿意且版本满足时再评估 |

B/C 未实现；当前离职处理依赖 `iam_user_state`/`iam_accounts` 既有机制或人工停用。

## 六、上线顺序与验收

1. 先用 `oidc:check` 确认配置与 discovery（不登录、不写库）。
2. 让对方建 client 并给测试账号；先开 `OIDC_PROFILE_LOGIN_MATCHING=1` + `OIDC_AUTO_PROVISION=0`，
   用测试账号验证：登录成功、JWT 可用、旧账号关联正确、重复登录不重复建号。
3. 再按需开 `OIDC_AUTO_PROVISION=1`；确认 visitor 无小组/管理/人脸权限。
4. 验收至少覆盖：正常登录、取消授权、错误 nonce/iss/aud（应为错误页而非白屏）、账号停用后拒绝、
   同浏览器多标签登录、手机浏览器、内外网入口、回滚到密码登录。
5. 保留密码登录作为 IdP 不可用时的备用入口；回滚只需 `OIDC_ENABLED=0`，不影响芯盾/钉钉。

测试：

```sh
npm --prefix apps/server run test:oidc        # 完整链路/重放/PKCE/nonce/验签/过期/停用/内嵌回跳
npm --prefix apps/web run test:oidc-login     # handoff、登录入口、消息来源和参数校验
```

## 七、给张老师的对接消息（可直接发群）

> 张老师好，我们要接入您这边的 Keycloak SSO，按 OIDC 标准做，麻烦帮我们开一个应用并确认几项：
>
> 1. **realm issuer 完整 URL**（形如 `https://<域名>/realms/<realm>`；请以 Keycloak 实际对外 hostname 为准，内外域名最好一致）。
> 2. **client_id / client_secret**（secret 请私发，不要贴群；或用一次性口令/加密通道）。
> 3. **回调地址**：`https://<MaMage 正式域名>/api/auth/oidc/callback`；如果内网要走 http，请再登记一条 `http://<内网地址>/api/auth/oidc/callback`（我们会在服务端单独开白名单）。
> 4. 客户端类型：**confidential**，Standard flow=ON，**PKCE S256**，Implicit/ROPC 关。
> 5. scope：`openid profile email`。
> 6. 需要的 claims：`sub`、`preferred_username`、`name`、`email`；**学工号/工号**若不在默认 claims 里，麻烦加一个 User Attribute mapper 并告诉我们键名。
> 7. 可选：如要按部门/组做权限，请加 Group Membership mapper 并开启 Add to userinfo，告诉我们组路径格式。
> 8. 一个测试账号（或让我们用某个账号连一次）；确认测试环境时钟已同步。
>
> 另外想请教：story.lab.bza.edu.cn 接入时用的 client 配置/回调规则能否参照？后续我们还想和您探索“自动化的对接”（定期同步用户/组、离职停用），到时可能需要一个只读 service account（`view-users`/`query-users`/`query-groups`），先不着急。

## 八、待确认 / 未实现

- [ ] 对方的 issuer、client_id/secret、学工号 claim 键名、是否支持 PKCE、测试账号
- [ ] Keycloak 版本与 Access Token Lifespan 实测值
- [ ] RP-Initiated Logout（目前 `/logout` 只跳 `end_session`，未保存 `id_token_hint`，不宣称完成登出）
- [ ] Admin API 定时对账 / SCIM（自动化对接第二步）
- [ ] 浏览器端到端测试（当前为服务端 mock IdP E2E + 前端单元测试；真实 Keycloak 起来后补 Playwright 用例）

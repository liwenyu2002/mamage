# 校园 IAM 登录与数据推送

## 接入边界

MaMage 接学校的芯盾时代 IAM，由 IAM 展示学校已配置的钉钉认证入口，不再另建钉钉应用。实际登录需要学校提供 IAM 地址、为 MaMage 登记的 OAuth 应用 ID/密钥和回调地址。谁能访问由 IAM 的应用授权范围控制，MaMage 不维护另一份登录名单。可用 OAuth 资料关联原账号并为新用户建立基础账号；应用数据推送独立负责目录同步和账号停用，不是扫码登录的前置条件。

代码默认关闭；本地模拟联调不代表真实学校扫码已验收。正常部署使用学校可信 HTTPS 入口，仍可仅内网访问。只有明确接受风险后，才可用 `IAM_ALLOW_INSECURE_HTTP_ORIGIN` 登记单个精确内网 IPv4 HTTP 来源；此时本站登录回跳和会话可能被内网窃听，Cookie 改为该主机专用的 HttpOnly/Lax 短期 Cookie。该例外不适用于 IAM 服务地址，密钥始终通过校验证书的 HTTPS 发往 IAM。不会使用文档示例地址或密钥。

2026-10-29 已核实学校 IAM 入口为 `https://idaas.bza.edu.cn`。授权入口对学校登记的 `http://10.1.131.37/` 根地址能进入登录流程，而专用子路径回调未通过注册检查。可用 `IAM_REDIRECT_URI` 精确指定根地址，Nginx 仅将含授权码/错误及 state 的根请求内部转交回调接口，不经过前端内容页面。该初步检查不能证明密钥正确或完整登录成功。

## 学校登记项

| 项目 | 内容 |
| --- | --- |
| OAuth 回调 | `https://<学校分配域名>/api/auth/iam/callback`，必须完整一致 |
| 部门推送 | `https://<学校分配域名>/api/integrations/iam/departments` |
| 账号推送 | `https://<学校分配域名>/api/integrations/iam/accounts` |
| 推送网络 | 明确 IAM 出口 IP/CIDR；若经反向代理，另登记可信代理地址 |
| 标识映射 | OAuth profile 的哪个稳定字段与账号推送 `externalId` 相同 |
| 协议确认 | `state` 必须原样回传；默认启用 S256 PKCE，需要学校确认支持 |
| 推送凭据 | 默认复用 OAuth 应用 ID/密钥；仅学校另配推送应用时才填独立项 |

密钥只放服务器私密环境配置或 Kubernetes Secret，不填代码、前端、普通文档或聊天。反向代理须保留路径和 HTTPS scheme，不能重写这几个外部签名路径。出站须能访问学校 IAM HTTPS，校验证书，不关闭 TLS 校验。

## 协议实现

- 授权码模式：`/sso/oauth2.0/authorize` → 服务端表单 POST `accessToken` → 服务端读取 `profile`。一次性 `state` 绑定浏览器 Secure/HttpOnly/Lax Cookie，校验回跳站点。
- IAM token 不给前端。回跳只携带两分钟有效、一次性、绑定浏览器的临时兑换码；前端立即清除 fragment 后同源换取本站登录态。原相册上传入口等站内地址会恢复。
- 推送按文档接受 form-urlencoded 五字段，签名为 `MD5(appId + salt + timestamp + 外部请求路径 + POST + appSecret)` 的大写十六进制，时间窗五分钟。
- 默认 `sdk-aes` 与文档内附 `sync_sdk_380` 一致：密钥是 appSecret 的小写 MD5 十六进制字符串的 32 个 ASCII 字节，AES-256-ECB/PKCS padding，Base64 密文。`sdk-sm4` 使用 secret 前 16 个原始字节、ECB/PKCS padding、十六进制密文；`aes-raw` 仅为明确确认使用原始 AES 密钥的部署提供。
- 内附 SDK 的其他签名工具与正文公式存在差异。当前只接受正文公式，不自动兼容多种签名；联调必须用学校实际推送样本核验。
- 文档的 MD5 签名未覆盖密文，不是现代完整消息认证。因此 HTTPS、来源限制、nonce/密文哈希绑定缺一不可，不能开放成无来源限制的公网接口。
- 返回成功 `code:1000,data:<请求签名>`；逐条失败返回 `code:9001,data:<标识到错误码的 JSON 字符串>`。相同请求可安全重试，旧事件不会覆盖新事件，同时间戳冲突会报错。全量批次缺少某人不等于删除，不据此清空目录。

## 账号与权限

1. 目录只保存必要字段，不保存推送密码，不接收 IAM 的管理员/人脸角色为本站授权。
2. 原账号通过下述可信 OAuth 资料规则关联，也可由管理员显式关联推送的稳定 `externalId`。不按姓名单独合并；关联保留原用户 ID、照片归属、小组和权限。
3. `IAM_AUTO_PROVISION=0` 为默认值。启用资料匹配并开启此项后，IAM 已授权的新用户可建立为 `visitor`；仅目录模式则仍需已推送的正常应用账号。两种方式均不会自动授予小组成员、管理或人脸权限，身份冲突需核对。
4. 部门推送保存为目录，当前不会自动更改本站小组、成员关系及授权。
5. 账号停用会撤销旧 JWT 和该账号的私有媒体签名访问，密码及其他登录入口也会拦截；恢复后必须重新登录，旧链接不会自动复活。已下载文件、公开分享和其他用户的授权不受此账号停用影响。
6. 使用 IAM 管理账号后，保留 `IAM_ACCOUNT_GUARD=1`。临时关闭扫码或推送只关闭对应开关，不关闭此保护；回滚也须保留本保护模块和表。单点退出协议尚未实现。

`IAM_PROFILE_LOGIN_MATCHING=1` 支持尚未收到目录推送时关联存量账号，不维护本站登录名单。谁能使用应用由学校 IAM 的 MaMage 应用授权范围控制；IAM 未设范围则可能允许所有校园用户，不能假定默认限制已生效。登录后只用 IAM HTTPS 返回的姓名加唯一邮箱或学工号匹配同组织账号；若明确配置 `IAM_SUBJECT_EMAIL_DOMAIN`，且 `profile.id` 本身为该域的学校受管邮箱，也可用该登录主体匹配唯一邮箱账号。姓名单独命中、重复邮箱、不同身份字段命中不同账号均拒绝，不改旧账号权限。开启 `IAM_AUTO_PROVISION=1` 后，已获 IAM 应用授权且没有旧身份冲突的新用户自动建立为 visitor，不授予小组、管理或人脸权限。发现同名旧账号但缺少核对依据时进入待核对，不悄悄制造副本。真实身份首次通过核对后写入 `iam_login_identities`；OAuth 登录标识与推送 externalId 分表记录，不假定二者相同。待核对队列只保存必要身份字段，不保存令牌、密码或完整 profile；可用 `pending-logins` 查看，七天后清理。`audit-existing <名单JSON文件>` 仅用于核查用户关心的旧账号，不建立名单或授权规则。

## 上线顺序

先备份数据库，再用现有 `npm run db:migrate` 执行增量迁移，包含 `20261028_001_iam_integration.sql` 和 `20261029_001_iam_login_links.sql`，不删除旧表或媒体。配置示例见 `apps/server/.env.example`，不要直接复制空值覆盖现有运行配置。

配置完成后执行 `npm run iam:check -- --database`，只输出脱敏的配置和表检查，不访问 IAM、不宣称真实登录成功。多副本继续使用现有 `MAMAGE_DISTRIBUTED_RUNTIME=1` 与共享数据库，OAuth 临时状态使用已有共享存储和锁。

先由学校限定应用授权范围，再开启 `IAM_PROFILE_LOGIN_MATCHING=1` 并验证学校实际返回的身份字段；需要自动建立基础账号时设置 `IAM_AUTO_PROVISION=1`。这条路径无需预置名单或先接收推送。数据推送另行核实出口地址、加密方式和标识映射后启用。仅目录模式可先推送两名测试账号，再使用本机/服务器管理员工具：

```sh
node scripts/iam_accounts.js pending
node scripts/iam_accounts.js bind '<stable-external-id>' <existing-local-user-id>
```

确认原相册、上传、管理员权限和普通成员边界不变，再开启 IAM 登录。验收至少覆盖钉钉扫码、深链接返回、未授权账号拒绝、停用后各登录方式失效、重复回调和伪造来源拒绝。密码登录保留，作为未关联账号及管理员处理故障的备用入口，但不能绕过被停用账号的保护。

推送回执默认保留七天、身份操作审计保留 180 天。运维每日运行 `node scripts/iam_accounts.js cleanup`，每表每次最多清理一万条；可重复执行。只删过期回执/审计，不删账号、绑定、停用状态或照片。OAuth 过期临时状态在登录入口按分钟限量清理。

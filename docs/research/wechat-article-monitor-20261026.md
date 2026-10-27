# wechat-article-monitor 旁路源码调查

**速读结论：列表发现/历史同步需要公众号后台扫码登录且有可登录账号；上游已宣布核心接口关闭，fork 仍调用同一列表接口，未见已查路径的修复证据。因此只能借鉴源码设计，未验证当前可用，不建议直接生产接入。**

- 调查日期：2026-10-26（Asia/Shanghai）。
- 仓库：`gudutianyu/wechat-article-monitor`；GitHub API 当次 `HEAD` 为 [`eed73e88b2bf8830da767f0c94909b01b91d4423`](https://github.com/gudutianyu/wechat-article-monitor/commit/eed73e88b2bf8830da767f0c94909b01b91d4423)，提交时间为 2026-04-24 15:50:01 UTC。fork 源码链接固定到此 SHA；上游版本另列于下。
- 方法与边界：只读该仓库及原上游 GitHub 第一方 README、源码、依赖清单和目录树；未执行仓库代码、安装依赖、操作登录、抓包或证书，未访问现有生产环境。静态源码事实与工程推断分开；未做运行可用性验证。许可字段由 GLM-5.3 辅助提取，已逐项对照原文件复核。
- 登录结论仅合并主代理提供的源码核查，见第 5 节；本旁路没有重复深入该链路。

## 0. 优先风险：上游已宣布核心接口关闭，暂不建议生产接入

**“存在分页代码”不等于“今天仍能采到历史”。** 原上游 `wechat-article/wechat-article-exporter` 当前 README 顶部明确宣布于 2026-07-30 停止维护，理由是所依赖的微信核心接口已关闭，并指向 #200。当次上游 `HEAD` 为 `152f23832c7f3664b86148e84bd3f75e513e4dd2`（2026-09-30 11:51:04 UTC）。[固定版本停维声明][upstream-warning]

本旁路逐字对照发现：fork 与上述上游版本的 `server/api/web/mp/appmsgpublish.get.ts` **完全相同**，仍请求 `https://mp.weixin.qq.com/cgi-bin/appmsgpublish`，使用 `fakeid + begin/count`。fork 自动发现、手动历史同步均汇入此路径；其 public article 路径也调用同一上游接口。[fork 代理][list-proxy]、[上游同文件][upstream-list]、[客户端入口][list-api]、[public 路径][public-article] fork 当次 HEAD 日期还早于上游停维日期；在已查路径中未见接口替换或关闭后的修复证据，不能以 fork README 的功能描述推定可用。

主代理已读取上游 README 和 #200，并独立确认两边列表端点都调用上述 URL；本旁路不再扩展调查，也不把停维声明扩大为“所有接口均失效”。**当前建议仅保留静态设计参考，不据此启动生产接入；未核实项是 fork 在当前微信接口条件下的实际可用性与历史完整性。**

## 1. 历史回溯与自动发现不是同一条链路

**有真实历史分页，但在用户触发的公众号同步中；自动发现仅轮询最新一页。**

| 路径 | 源码行为 | 边界 |
| --- | --- | --- |
| 历史列表同步 | `pages/dashboard/account.vue::_load` 调用 `getArticleList(account, begin)`，按本页 `itemidx === 1` 的消息数推进 `begin`，再通过 `window.setTimeout` 继续翻页；空页或达到日期下界停止。[历史循环][history] | 从界面触发；每次 `loadAccountArticle` 从 `begin=0` 开始，不是独立服务端回溯任务。[启动入口][history-start] |
| 分页请求与响应 | 客户端传 `begin/size`，页大小配置为 20；服务端将其传为上游 `begin/count`；响应 `publish_list[].publish_info.appmsgex` 被展开为文章列表。[客户端][list-api]、[页大小][page-size]、[服务端][list-proxy] | 页大小针对发布消息列表，不等于最终文章数，一条消息可能包含多篇文章。源码存在分页不证明当前接口能完整返回全部历史。 |
| 回溯范围与节流 | 默认 `syncDateRange='all'`、页间隔 3 秒；支持最近若干天/月/年、自定义日期。循环在偏好缺失时回退到 5 秒。[默认值][preferences]、[日期范围][range]、[历史循环][history] | 添加公众号时显式 `loadMore=false`，只同步第一页；后续须执行同步。[添加行为][add-account] |
| 自动发现 | 默认每 5 分钟执行一次；固定 `getArticleList(account, 0)`，只把发布不超过 1.5 小时、且尚无对应评论任务的文章发出为 `discovered` 事件。[轮询实现][discovery]、[周期][discovery-timer] | 不翻下一页，不回补停机期间窗口之外的监控任务；`last_known_aid` 只被更新，未作为翻页游标使用。界面最多添加 5 个监控公众号。[上限与入队][discovery-composable] |

两个容易混淆的细节：

- **90 分钟过滤针对发现事件/评论任务，并非列表缓存过滤。** `getArticleList` 在返回前已将无关键词的整页列表写入缓存，所以旧文章可能有第一页元数据，却没有被自动加入监控。事件随后进入 `enqueueAuto`，任务从入队时起再追踪 1.5 小时。[缓存写入][list-api]、[发现过滤][discovery]、[任务创建][enqueue]
- **历史列表同步不等于正文全部下载。** 公众号同步缓存列表；文章页另行对选中的 URL 执行 HTML 抓取/导出。[列表缓存][article-cache]、[正文操作][article-actions]

工程推断：恢复运行时，已被挤出第一页或超过发现窗口的文章不会由自动发现补齐。历史同步虽可另行分页，却没有展示持久化分页检查点；缓存“快进”还假定较早缓存可跳过，源码 TODO 明示存在多段不连续范围问题，不宜据此承诺历史完整性。[历史循环][history]、[每次从零开始][history-start]

## 2. 调度在浏览器，IndexedDB 只持久化数据

| 部分 | 实际位置与证据 |
| --- | --- |
| 发现调度 | 浏览器 JavaScript 内存中的 `AccountDiscoveryPoller`、`setInterval`；页面隐藏时主动清除定时器，可见时再启动。[发现调度][discovery-timer] |
| 评论调度 | 浏览器 JavaScript 内存中的 `CommentMonitorScheduler`；默认每 30 秒检查 `tracking/final_collecting` 任务，页面隐藏同样暂停。[评论调度][comment-timer]、[任务循环][comment-loop] |
| 启动及恢复 | 监控页面调用 `useMonitor()`；facade 按需启动两个 composable。评论侧只为已有 `tracking/final_collecting` 任务自启，恢复依赖再次运行客户端代码。[页面入口][monitor-page]、[facade][monitor-facade]、[评论恢复][comment-resume] |
| 数据持久化 | Dexie/IndexedDB 存文章、HTML、评论、关注账号和任务状态；这不是后台执行器。[数据库][db]、[任务读写][task-store] |
| Nitro 服务端 | 已查列表端点是请求代理，PDF 端点按请求调用 Puppeteer 渲染 HTML；未见承担上述监控循环的服务端 worker 入口。`server/api/web/worker` 实为外部公共代理指标接口，不是文章调度器。[列表端点][list-proxy]、[PDF][pdf]、[worker README][worker-readme]、[指标端点][worker-metrics] |

**学校 Linux 结论：具备托管 Web 服务的部署基础，不具备开箱即用、脱离浏览器的无人值守监控架构。** `ssr:false` 明确是 SPA；Dockerfile 使用 Node 22 并启动 Nitro，所装 Chromium 用于按需 PDF 渲染，不能据此推定会打开监控页面或运行发现定时器。服务端配置 KV 也不能替代客户端 IndexedDB 和定时器。[Nuxt 配置][nuxt]、[Dockerfile][docker]、[PDF][pdf]

这是架构判断，不是 Linux 实机验证，也不是“Linux 不能运行”的结论。把常驻浏览器/headless 页面补成守护服务属于额外开发与运维；当前源码未提供该能力。即使主代理确认凭据可用，浏览器生命周期、隐藏暂停、历史补漏仍是独立阻碍。若集成到 MaMage，应由服务端接管持久任务、分页检查点、失败恢复和幂等写入；这些是建议，不是本次实现。

## 3. 许可边界：项目 MIT 与企业版依赖分别核查

- **项目声明：MIT。** 顶层 LICENSE 同时列出 2024 Jock（原项目）及 2026 tomczhang（fork 与改动）；文本要求在软件副本或实质性部分中包含版权和许可声明，并包含免责声明。复用相关源码时应保留这些通知。[LICENSE][license]
- **AG Grid Enterprise 不是未使用的依赖。** `package.json` 直接依赖 `ag-grid-enterprise ^34.0.0`；`yarn.lock` 锁定为 `34.3.1`。`app.vue` 无条件注册 `AllEnterpriseModule`，并调用 `LicenseManager.setLicenseKey`；key 配置来自 `NUXT_AGGRID_LICENSE`。[依赖][package]、[锁定版本][ag-lock]、[运行时注册][ag-runtime]、[配置][nuxt]
- **不要把顶层 MIT 推广到整个依赖树。** 该仓库没有在上述文件中给出 AG Grid Enterprise 的具体授权条款，也不能凭环境变量存在断定已获有效授权。整套前端引入前，需单独核查企业版及其他随附依赖的许可；锁文件还列有可选 `ag-charts-enterprise`。若只抽取不依赖表格 UI 的适配逻辑，应保持依赖隔离，避免顺带引入企业模块。[依赖清单][package]、[锁文件][ag-lock]、[运行时注册][ag-runtime]
- **文章内容权利是另一层问题。** README 将采集内容版权归于原作者，不能把项目代码的 MIT 当作文章内容的再利用授权。[README 声明][readme-rights]

以上仅记录仓库中的许可与依赖事实；未读取供应商当前条款、未完成全量依赖许可审计，也不判断学校、内网、免费或商业使用是否合法或是否需要购买授权。

## 4. 对 MaMage 的复用价值与替换边界

以下为静态源码复用判断，不是对 MaMage 当前实现的审计，也不是生产接入建议。受第 0 节风险约束，若后续证实来源可用，候选边界仅为：**目录发现/历史列表适配接 MaMage 服务端队列，正文仍用我方逆向，评论与抓包暂不接。**

| 适合借鉴/选择性移植 | 对 MaMage 的价值与验收边界 |
| --- | --- |
| `begin/count` 历史列表适配与 `publish_info.appmsgex` 展开 | 仅作历史来源适配器的静态参考，接口可用性未成立；即便后续接入，也须另加服务端持久检查点、空页/日期停止和历史缺口验证。已有 public article 端点接受 `fakeid/begin/size/keyword`，但只返回本页 `articles`，不含客户端内部接口提供的完成标志与总数，不能当成整库同步接口。[列表解析][list-api]、[public 端点][public-article] |
| `(fakeid, aid)` 文章标识、关注账号与文章任务拆分 | 可借鉴幂等标识和能力拆分；缓存主键已用 `fakeid:aid`。自动发现依据现有任务集合去重，不应直接当成跨进程任务唯一性保证。[缓存主键][article-cache]、[任务模型][task-store]、[发现实现][discovery] |
| 评论快照差分与 first-seen/last-missing 记录 | 仅为后续研究参考，本轮不接评论。源码按 `content_id` 合并、记录本轮未出现的评论；“未出现在本次响应”不足以证明被平台屏蔽。[差分与时间记录][comment-diff] |
| 下载状态、重试与导出流程 | 可参考 URL 队列、失败集合、指数重试及报告输出，但不替换我方正文获取。它不是可直接搬到 Linux 的独立 SDK，代码耦合 Vue 偏好、IndexedDB、DOMParser 和浏览器下载。[下载基础][downloader]、[报告生成][report]、[浏览器导出][browser-export] |

**不适合整套替换：** 不应用 Nuxt/Vue/AG Grid 管理前端、Dexie 归档及浏览器 Poller/Scheduler 替代 MaMage 面向服务器的存储、任务执行和编辑工作流；也不要照搬“最新一页 + 90 分钟”作为完整增量采集策略。[SPA 与企业表格][nuxt]、[数据库][db]、[发现实现][discovery] 当前价值是历史分页及字段解析的源码参考，不是已验证可用的学校 Linux 无人值守采集后端。

## 5. 主代理补充：登录与凭据边界

以下按主代理提供的源码核查结果合并，旁路未重复核验相关文件；不表示真实登录或接口已验证成功。

- `components/modal/Login.vue` 走 session/getqrcode/scan/bizlogin；扫码后没有可用公众号时，`acct_size < 1` 显示“没有可登录账号”。[登录组件][login-main]
- `searchbiz.get.ts`、`appmsgpublish.get.ts` 先 `getTokenFromStore`，无 token 则返回未登录/已过期；后者携带 `fakeid + begin/count` 拉取其他目标号列表。登录态存在仍不证明第 0 节涉及的上游接口可用。[搜索端点][search-main]、[列表端点][list-proxy]
- `apis/index.ts` 的 `getArticleList` 使用公众号后台登录态；`getArticleListWithCredential` 使用 `uin/key/pass_ticket` 微信客户端凭据，评论也有另外的凭据要求，不能视为同一套授权链路。[API 区分][api-credentials]
- `server/kv/cookie.ts` 配置 4 天 KV 保存时间，**不是微信真实会话有效期承诺**。[KV 配置][kv-main]
- `server/plugins/credential-service.ts` 尝试启动 `mitmdump`。研究期间未运行它、未扫码、未安装证书；候选集成不包含评论与抓包。[服务插件][credential-main]

[history]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/pages/dashboard/account.vue#L87-L152
[history-start]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/pages/dashboard/account.vue#L154-L187
[list-api]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/apis/index.ts#L19-L71
[page-size]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/config/index.ts#L13-L16
[list-proxy]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/server/api/web/mp/appmsgpublish.get.ts#L1-L60
[preferences]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/composables/usePreferences.ts#L5-L31
[range]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/composables/useSyncDeadline.ts#L8-L51
[add-account]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/pages/dashboard/account.vue#L67-L75
[discovery]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/utils/monitor/AccountDiscoveryPoller.ts#L106-L155
[discovery-composable]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/composables/useAccountDiscovery.ts#L13-L97
[enqueue]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/composables/useCommentMonitor.ts#L145-L185
[article-cache]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/store/v2/article.ts#L12-L52
[article-actions]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/pages/dashboard/article.vue#L539-L548
[discovery-timer]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/utils/monitor/AccountDiscoveryPoller.ts#L6-L99
[comment-timer]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/utils/monitor/CommentMonitorScheduler.ts#L9-L98
[comment-loop]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/utils/monitor/CommentMonitorScheduler.ts#L100-L167
[monitor-page]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/pages/dashboard/monitor.vue#L1-L43
[monitor-facade]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/composables/useMonitor.ts#L11-L29
[comment-resume]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/composables/useCommentMonitor.ts#L294-L305
[db]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/store/v2/db.ts#L1-L72
[task-store]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/store/v2/commentMonitorTask.ts#L10-L69
[pdf]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/server/api/web/pdf/generate.post.ts#L1-L39
[worker-readme]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/server/api/web/worker/README.md#L1-L3
[worker-metrics]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/server/api/web/worker/overview-metrics.get.ts#L1-L12
[nuxt]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/nuxt.config.ts#L7-L47
[docker]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/Dockerfile#L27-L67
[license]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/LICENSE#L1-L22
[package]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/package.json#L15-L63
[ag-lock]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/yarn.lock#L2721-L2743
[ag-runtime]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/app.vue#L12-L25
[readme-rights]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/README.md#L150-L158
[public-article]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/server/api/public/v1/article.get.ts#L23-L83
[comment-diff]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/utils/monitor/task-sync.ts#L195-L254
[downloader]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/utils/download/BaseDownloader.ts#L1-L139
[report]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/utils/monitor/MonitorExporter.ts#L60-L110
[browser-export]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/composables/useCommentMonitor.ts#L28-L75
[upstream-warning]: https://github.com/wechat-article/wechat-article-exporter/blob/152f23832c7f3664b86148e84bd3f75e513e4dd2/README.md#L13-L21
[upstream-list]: https://github.com/wechat-article/wechat-article-exporter/blob/152f23832c7f3664b86148e84bd3f75e513e4dd2/server/api/web/mp/appmsgpublish.get.ts#L15-L60
[login-main]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/components/modal/Login.vue
[search-main]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/server/api/web/mp/searchbiz.get.ts
[api-credentials]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/apis/index.ts#L19-L157
[kv-main]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/server/kv/cookie.ts
[credential-main]: https://github.com/gudutianyu/wechat-article-monitor/blob/eed73e88b2bf8830da767f0c94909b01b91d4423/server/plugins/credential-service.ts

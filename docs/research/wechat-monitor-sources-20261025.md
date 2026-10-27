# 微信公众号监控与历史补录：来源研究

查阅日期：2026-10-25，Asia/Shanghai。目标：`哈尔滨工业大学`、`北京中关村学院`，历史下限 `2024-01-01`（含）。仅研究和小样本公开访问；不使用账号凭据、不登录、不处理验证码、不大规模抓取、不运行导入或定时任务。只新增本文，未改代码或生产配置。以下区分实测事实、未核实项和后续设计建议。

**2026-10-26 实现复核补记：** 下文保留原调查当时的访问结果，不应外推成所有读取渠道不可用。随后用 Kimi WebBridge 正常打开了两号各一篇完整原文，且已有粘贴链接逆向接口能直接读取同一哈工大样本。监控此前误用了单独的目录爬虫链路，已改为复用逆向抓取器，并真实入库 10 篇目标文章、完成相应模型分析。其中《哈工大2024年新年献词：鼓足干劲 再立卓越新功》通过正常搜狗搜索及点击发现，微信原文核验日期为北京时间 2024-01-01 07:58，证明可沿用粘贴原文链接的导入方式，不需要另建内容抓取工具。官网旧目录的 `.psp` 跳转也已在严格路径白名单内兼容。两个目标标识通过各两篇官网公布的独立文章一致性完成交叉核验。搜狗后台爬虫仍未启用，普通浏览器搜索仍可作为人工发现入口；这些实测不证明历史全量、长期稳定性或取得转载授权。最新边界以 [实现与验收](../wechat-monitor.md) 为准。

**同日后续验证：** 又经正常搜狗浏览器发现《最新！哈工大发布2024年卓越优才计划-高校专项计划招生简章》，微信原文显示 2024-04-10 17:04，发布者与已核验标识一致。已沿用相同导入链路入库并完成真实分析，当前合计 11 篇；少量搜索样本仍不能证明任何月份已收齐。

## 结论

- **按用户指定优先研究搜狗微信，但不能把它直接接成无人值守爬虫。** 未登录普通浏览器能完成两个机构名称各一次文章检索；搜索抓取工具则无法读取结果页。搜狗 `robots.txt` 的通配规则为 `Disallow: /`；用户协议第 6.1.1、8.1 条限制爬虫获取、机器人监视和复制。建议搜狗适配器默认 `enabled=false / policy_disallowed`，保留人工公开检索入口；公开可浏览不等于获得后台抓取许可。[S1][S2][S3]
- 可继续论证的后台来源是**机构官网公开索引、公开 sitemap，以及未来经机构正式授权的微信 API**。它们均不构成“两个公众号自 2024 年起全部历史”的证明。既有单篇逆向导入解决已知 URL 的内容解析，不解决发现、账号归属、授权或覆盖率问题。

## 搜狗微信：已验证的公开表面

证据来自 2026-10-25 的首页表单、两次未登录浏览器首屏与分页链接属性；没有批量翻页，也没有解码搜索跳转或访问隐藏接口。[S1][S4][S5]

| 项目 | 实测结果与适配边界 |
| --- | --- |
| 搜索入口 | `GET https://weixin.sogou.com/weixin`；表单字段为 `type=2`（搜文章）、`query`、`ie=utf8`，另有 `s_from=input`、`_sug_=n`、`_sug_type_`。建议用 URL/查询参数 API 编码，不手拼中文。两家入口见 [哈工大检索][S4]、[学院检索][S5]。这是网页表面，不是已承诺的开放 API。 |
| 分页 | 哈工大首屏实际给出 `page=2`、`page=10` 和“下一页”链接，下一页保留原查询参数。只验证了链接存在，未请求第二页；未验证最大可翻页数、稳定页大小或完整结果可达性。未来若获准访问，应跟随实际 `next_url`，不按估算结果数枚举页码。 |
| 时间与排序 | 两个首屏均未展示日期筛选控件；表单也无日期字段。学院首屏交错出现 `2026-3-18`、`2026-3-4`、`2026-3-23` 与“2天前”，不能按首条或末条日期提前停止。未验证 `tsn`、`ft`、`et` 等网上常见参数，不把它们写成可用接口。搜狗一般网页帮助提及时间筛选，但不能外推为微信搜索当前能力。[S6] |
| 公众号筛选 | 当前首页/结果表单只观察到“搜文章”，未观察到公众号专属选择器，也未验证 `type=1`、`usip` 等机制。机构名是全文关键词，不是发布者条件。哈工大首屏出现“感算圈”“今日校园请假”等账号；学院首屏出现“北邮研究生招生”“首都教育”“北京中关村学院研究生会”等，均不能直接归入目标号。 |
| 日期原始值 | 有绝对日期，也有“7小时前”“1天前”。保存原文、观察时刻和时区；相对时间只能形成近似范围，不能伪造成微信精确发布时间。搜索日期与官网日期、微信发布日期分字段保存。 |
| 结果链接 | 抽查标题的 `href` 是搜狗 `/link?url=…&type=2&query=…&token=…`，不是微信 canonical URL。保留发现来源；临时跳转不作文章主键，不在文档/日志保存 token，不逆向、重签或拼接跳转参数。仅在允许的正常跳转取得目标地址后记录 `wechat_url`。 |
| 覆盖量 | 首屏显示约 8,838 / 2,145 条，分别是宽泛关键词的估算命中，不是两个公众号的文章总数。搜狗官方也说明一般搜索数量是估算值、不保证全部网页收录；该说明不是微信历史完整性承诺。[S7] |
| 访问状态 | 两次普通界面查询未触发搜狗 CAPTCHA，且页面有“登录”入口，本次未登录。不能因此推断后台 HTTP 请求可长期稳定运行。抓取工具不可访问不是“0 条结果”，也不能凭此声称搜狗实际出现了验证码。 |

**日期回补策略是建议，不是已验证搜狗能力：** 在获准的发现渠道中收集候选，再按经过核验的文章发布日期做 `>= 2024-01-01` 本地筛选；月份关键词只能辅助发现，不能替代真正日期过滤。没有已核验日期的条目进入 `date_unverified`，不擅自排除或算作覆盖完成。

### 建议的适配器元数据

| 层次 | 最小字段/规则（未实现） |
| --- | --- |
| 来源配置 | `provider=sogou_wechat`、`enabled=false`、`policy_status`、`terms_url`、`robots_checked_at`、`query`、`requested_since=2024-01-01`、`date_filter_support=unverified`。人工检索与自动任务分开；取得许可前不设后台翻页计划。 |
| 发现记录 | `discovered_from`（搜索 URL）、`observed_at`、`page_url`、`rank`、`title`、`snippet`、`publisher_label`、`search_display_date_raw`；搜索摘要不能当全文。跳转 token 不进入长期日志。 |
| 身份与原文 | `wechat_username`、`original_id`、`biz`、`identity_evidence_url`、`identity_verified_at`、`publisher_match=unverified/verified/rejected`、`wechat_url`、`site_url`、`source_kind`。未知值为 `null`，不从标题、域名相同或机构同名推断 `biz`。 |
| 日期与去重 | `site_published_at`、`wechat_published_at`、`date_precision`、`date_evidence_url`、`first_seen_at`、`last_checked_at`、`content_hash`。已获得长微信 URL 时保留 `__biz/mid/idx/sn`，不要把同次推送的不同 `idx` 合并；短链接与长链接只有在正常解析证明相同时建立别名。 |
| 状态与停止 | 区分 `policy_disallowed`、`captcha_required`、`login_required`、`rate_limited`、`fetch_failed`、`empty_verified`、`content_unverified`。验证码、登录墙、403/429 或明确反自动化提示立即停该来源，不换 IP/UA、不搬运 cookies、不接打码服务，不持续重试；不能把阻断记作历史为空。 |

搜狗免责声明不保证第三方内容的准确性、真实性；其搜索收录也不授予原文转载权。微信公众平台协议第 5.2.2.12、10.1、10.5、10.6 条另涉及非正常取数、内容权利和原链接展示。全文保存、二次发布与现有导入器的使用仍须单独核实权利依据；本文不是合法性保证。[S8][W6]

## 目标身份与 biz

| 目标 | 官方证据 | 可以确认 / 仍然不能确认 |
| --- | --- | --- |
| 哈尔滨工业大学 | 学校主页“全景哈工大”直接给出微信文章；新闻网明确报道“哈尔滨工业大学微信公众号”。研究生院 2024-08-20 通知写出 `iHIT1920`，但称其为“哈工大微信服务号”。[H1][H2][H3] | 目标机构与校级官微存在可确认；`iHIT1920` 是校方提供的候选微信号，但“服务号”称谓有歧义，本次未完成它与目标内容号的卡片绑定核验。不能混入“哈尔滨工业大学服务号”、院系、招生、深圳/威海、校友等独立账号。`original_id`、目标内容号 `biz` 均未核实。 |
| 北京中关村学院 | 官网 2025-05-28 夏令营通知明确给出微信公众号 `bjzgca`；2026 年通知写名称“北京中关村学院”；官网页脚提供多个微信二维码。[B1][B2][B3] | `bjzgca` 有日期明确的官方历史证据，名称有较新官方证据；仍需普通可访问的公众号资料页确认当前绑定。页脚某二维码文件名含 `gh_859004c12c30`，但多二维码缺少可核验对应关系，**不能据文件名把它认定为目标原始 ID**。`biz` 未核实。 |

没有从搜狗两个首屏、两家官网已查链接中得到可可靠归属目标号的 `__biz`。学校教师页面或媒体报道中的其他微信长链接不代表校级官微。短链接不反推 `biz`，不绕过微信验证页获取页面变量；后续只接受正常可读原文/账号卡片与官方出站链接交叉核验。`biz`、微信号、`gh_*`、API `AppID` 不是同一种标识，也不能互相替代。

## 官方索引、RSS 与站点地图

| 来源 | 已观察到的入口 | 覆盖边界 |
| --- | --- | --- |
| 哈工大官网/新闻网 | [学校主页][H1]、[学校要闻][H4]、[哈工大全媒体][H5]。要闻有公开下一页/尾页链接，本次显示每页 16 条、共 6,488 条/406 页；未遍历。 | 包含官网正文、微信外链及其他媒体；“媒体看工大”的微信文章可能属于光明日报等账号。栏目总数不是目标官微总数，“哈工大全媒体”也不是微信一一镜像清单。 |
| 北京中关村学院 | [学院资讯][B4]含新闻资讯、学院动态等；动态有分页界面，HTML 内公开 `__NUXT_DATA__` 带标题、日期、`uuid`、外链 `link`。[robots.txt][B5]明确公布 [sitemap.txt][B6]。 | sitemap 本次为 426 行公开 URL，混合机构页面、新闻、文化等，无逐条发布时间；仅下载此清单，未遍历文章。部分动态有微信链接，部分有官网正文，部分详情只有标题日期，不能把所有 `/detail/` 当全文镜像。只论证公开页面，不探测 `/adminapi` 后台。 |
| RSS/其他 sitemap | 抽查两家主页、上述新闻索引的 `link[rel=alternate]`，未发现可核验 RSS/Atom。哈工大 `www` 与 `news` 两主机 `/robots.txt`、`/sitemap.xml` 均返回 404；学院 `/sitemap.xml` 返回 404，但有上面的官方 TXT sitemap。 | 这是本次指定路径的观察，不是证明全站不存在其他 feed。不要把 RSSHub/第三方公众号聚合服务标成官方 RSS，也不把 robots 缺失或允许抓取当成版权授权。 |

学院主页自述 2024 年 9 月成立，官方大事记记载 2024-09-13 首届开学典礼。这能解释机构历史跨度，**不能证明公众号此前不存在、未更名或没有文章**。本次未找到该号 2024 年完整目录，2024 年各月份仍须标记未核实。[B3][B7]

## 代表样本与原始链接

“微信原文链接”指官方页面实际公布的 `mp.weixin.qq.com` 地址；未声称已读到该页 `rel=canonical` 或完成正文核验。日期严格按证据来源标注，官网日期不冒充微信首发日期。

| 日期与证据 | 标题及官方公布的原始地址 | 类型 / 核验状态 |
| --- | --- | --- |
| 2024-08-01，官网正文页显示 | [哈尔滨工业大学关于优化校园参观有关事项的通知][H6] | 官网正文，不是微信原文；本次正文中未见对应微信文章链接。证明能发现 2024 年官网内容，不证明已补录官微。 |
| 2025-03-16，官网正文页显示 | [全国高校唯一 哈尔滨工业大学微信公众号获中央网信办通报表扬][H2] | 官网自采报道；URL 路径含 `0315`，但显示日期是 03-16，说明不能只从路径猜发布日期。 |
| 2026-10-21，官网要闻索引标注 10-21 | [哈工大大型全景式话剧《仰望者》震撼上演！](https://mp.weixin.qq.com/s/iYURNHK0565-bHakjuUslA)，发现页：[学校要闻][H4] | 实际微信外链候选；微信正文抓取未成功，账号身份、微信精确发布时间待核验。官网另有媒体报道，不能因同标题自动合并。 |
| 2025-05-28，官网正文页显示 | [北京中关村学院2025年“直博生夏令营”活动通知][B1] | 官网正文，含 `bjzgca` 官方身份线索；不是微信 URL。 |
| 2025-09-08，官网正文页显示 | [欢迎新同学！北京中关村学院2025级新生报到][B8] | 可读官网正文，不能据此认定已找到该篇微信版本。 |
| 2026-09-28，官网动态及公开嵌入记录 | [北京中关村学院AI共创营（第二期）报名开启：从真实需求出发，迈出AI创业第一步](https://mp.weixin.qq.com/s/JZImv5Ga82fLirkegzVY7Q)；[官网详情壳][B9]，记录来自 [学院资讯][B4] | 实际微信外链候选，微信正文未核验；详情页有标题日期但本次未读到文章正文，不能把它当完整镜像。 |

访问限制实测：对官网公布的 [哈工大“逐梦国际舞台！她从哈工大出发”](https://mp.weixin.qq.com/s/bREI7WMzy1PgaRFznHVv3w)及[学院首页微信链接](https://mp.weixin.qq.com/s/AUj2wXYcK1xAYC9Qye5v8g)各做一次匿名访问，均返回“环境异常，完成验证后即可继续访问”；立即停止，没有验证、登录或替代抓取。不能因此说文章已删除，也不能把验证页送入导入器。

## 微信官方 API 的归属与限额

仅阅读官方文档，未请求任何 API、获取 token 或读取密钥。旧 `offiaccount` 文档路径会迁移，以下引用当前公众号文档。

| 能力 | 官方契约与本任务影响 |
| --- | --- |
| 调用身份 | `getAccessToken` 需要该账号 `AppID`/`AppSecret`；token 有效期由 `expires_in` 返回，文档为 7200 秒以内。API 存在 IP 白名单与权限约束。公众号名称、微信号或 `biz` 不能让 MaMage 读取另一个机构的后台。[W1] |
| 已发布列表 | `POST /cgi-bin/freepublish/batchget` 要求账号 `access_token`；第三方需对应权限集 7 的正式授权并使用 `authorizer_access_token`。请求为 `offset`、`count=1..20`、可选 `no_content`；没有按任意公众号名/biz或 `since` 查询的参数。[W2] |
| 账号资格 | 发布能力说明自 2025 年 7 月起回收个人主体、企业未认证及不支持认证账号的接口权限；当前列表接口表将公众号标为“仅认证”。不能假定两家目标号均已获得该权限，也不能用我们自己的账号凭据代查。[W2][W3] |
| 每日/频率限额 | 官方默认额度表给“获取成功发布列表”100 次/日；每次最多 20 个发布素材记录，不是 20 个任意公众号、也不是全部历史保证。实际账号额度可能调整，应在获授权后查 `openapi/quota/get` 的 `daily_limit/used/remain`、频率周期。第三方代调用消耗目标号额度；本次未实测。[W2][W4][W5] |
| 素材不等于已发布历史 | `material/batchget_material` 按素材类型列永久素材，同样需账号或授权 token、每次 1..20 条；不能用素材/草稿列表证明全部已发布文章。[W7] |
| 时间和链接语义 | 已发布列表的 `update_time` 是更新时间，不是首发日期；`news_item` 可有多篇。`content_source_url` 是“阅读原文”跳转地址，不是微信文章 canonical URL。文档没有承诺它能恢复全部已删文章或完整覆盖 2024 年以来各发布方式；需与账号方目录及原文核对。[W2] |

## 可行范围与验收建议

1. **监控：** 搜狗保持人工发现来源，不能仅因普通浏览器可用就打开后台爬取。官网索引/sitemap可作为后续评估的自动发现主来源；建议初始每日一次、单并发、条件请求、重复链接去重，频率是我们的建议而非网站授权。变化先入候选队列，核验账号和权利后才调用现有单篇导入器。本文未配置任何任务。
2. **历史：** 从 `2024-01-01` 到观察日建立按来源、按月份的回补台账。只沿公开目录发现链接，不猜 CMS ID、不按搜索估算数扫页；在允许范围内分小批次、可恢复推进。页码会漂移，需重叠窗口与已知 URL 去重。未授权 API、索引未收录、删改、迁站、验证失败、日期未知分别记录缺口。
3. **出处：** `source_kind` 至少分 `official_site_body`、`official_site_wechat_link`、`sogou_candidate`、`authorized_wechat_api`、`third_party_reprint`。官网正文与微信正文各自保存出处，只有核实关联才链接为同一作品的不同版本，不静默替换来源。
4. **完成口径：** 报告“已发现候选、已核验目标号、已取得正文、被阻断、日期/身份待核实”的数量和实际日期范围；每月是 `partially_observed/unverified` 等证据状态，而不是“有结果即全量完成”。本次是来源可行性研究，**不是完成历史回补**；两家目标号的 `biz`、搜狗微信日期筛选和 2024 年完整性仍未证实。

## 官方来源

[S1]: https://weixin.sogou.com/
[S2]: https://weixin.sogou.com/robots.txt
[S3]: https://www.sogou.com/docs/user.htm?v=1
[S4]: https://weixin.sogou.com/weixin?type=2&query=%E5%93%88%E5%B0%94%E6%BB%A8%E5%B7%A5%E4%B8%9A%E5%A4%A7%E5%AD%A6&ie=utf8
[S5]: https://weixin.sogou.com/weixin?type=2&query=%E5%8C%97%E4%BA%AC%E4%B8%AD%E5%85%B3%E6%9D%91%E5%AD%A6%E9%99%A2&ie=utf8
[S6]: https://help.sogou.com/result.html?v=1
[S7]: https://help.sogou.com/receive.html
[S8]: https://www.sogou.com/docs/terms.htm?v=1
[H1]: https://www.hit.edu.cn/
[H2]: https://news.hit.edu.cn/2025/0315/c11819a237593/page.htm
[H3]: https://hitgs.hit.edu.cn/2024/0820/c17528a351212/page.htm
[H4]: https://news.hit.edu.cn/xxyw/list.htm
[H5]: https://news.hit.edu.cn/hgdqmt/list.htm
[H6]: https://news.hit.edu.cn/2024/0801/c11508a236325/page.htm
[B1]: https://www.bza.edu.cn/detail/hdgr8zc0mgbgl4i8n8umiwh1o4tybx59
[B2]: https://www.bza.edu.cn/detail/5wmh4cvjvf923xhl4hl9d63wnwvgy5ee
[B3]: https://www.bza.edu.cn/
[B4]: https://www.bza.edu.cn/news/
[B5]: https://www.bza.edu.cn/robots.txt
[B6]: https://www.bza.edu.cn/sitemap.txt
[B7]: https://www.bza.edu.cn/about
[B8]: https://www.bza.edu.cn/detail/39lo39yg0uvjvtkyeevoov8j4q6bjqmn
[B9]: https://www.bza.edu.cn/detail/zrp5ncfyhzrddx3ljox09ogf5ilsay2l
[W1]: https://developers.weixin.qq.com/doc/subscription/api/base/api_getaccesstoken.html
[W2]: https://developers.weixin.qq.com/doc/subscription/api/public/api_freepublish_batchget.html
[W3]: https://developers.weixin.qq.com/doc/subscription/guide/product/publish.html
[W4]: https://developers.weixin.qq.com/doc/subscription/guide/dev/api/limit.html
[W5]: https://developers.weixin.qq.com/doc/subscription/api/apimanage/api_getapiquota.html
[W6]: https://mp.weixin.qq.com/cgi-bin/readtemplate?t=home/agreement_tmpl&type=info&lang=zh_CN
[W7]: https://developers.weixin.qq.com/doc/subscription/api/material/permanent/api_batchgetmaterial.html

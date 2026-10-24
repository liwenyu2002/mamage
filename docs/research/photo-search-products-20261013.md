# 照片自然语言搜索：Google Photos、Apple Photos、Immich

核验日期：2026-10-13。面向 MaMage 校园图库，现状以任务提供的“人脸库 + 描述/标签 SQL LIKE + LLM 转查询”为前提，未审计其代码或运行效果。

范围：仅联网读取官方帮助、官方文章和官方仓库；未访问生产环境、登录私人图库、调用子代理或提交代码，仅新增本文。既有新闻稿改动不属于本次任务。

证据口径：**帮助文档明确支持**不代表本次实测通过；**源码可见实现**仅代表指定版本；**官方文章**可说明厂商设计或演示，不能充当准确率、召回率或校园场景验证。下文“未公开/未找到”仅限本次核验来源，不等于证明产品不支持。

## 一、最有用的五条结论

1. **人物与描述可以组合，但不能据此承诺多人属性绑定。** Google 普通搜索已有“人物一起笑”的例子；Apple 帮助直接给出“某人穿扎染衫滑滑板”。两者均未在所查资料中提供校园合影里“衣服/动作必定属于指定人物”的准确率或保证。[Google 搜索][G1]、[Apple 搜索][A1]
2. **LLM 理解句子与图库能够召回是两件事。** Immich 将查询编码为向量，结合人物等结构化过滤搜索已存图片向量，不要求描述字段含有同一关键词。仅让 LLM 换一种方式生成 LIKE，不能补回从未被描述/标签记录的视觉证据；这是对 MaMage 的工程推论。[Immich 搜索][I1]、[查询编码][I6]、[图片编码][I7]
3. **否定必须区分数据库排除和视觉语义否定。** Immich 当前发布版确有 `personIds/tagIds/albumIds.none`、字符串 `notLike` 等结构化排除；不能写成“三家都不支持否定”，也不能把这些操作等同于可靠理解“不要红衣服”。Google/Apple 所查搜索帮助没有公开通用自然语言 NOT 契约。[过滤接口][I3]、[SQL 实现][I4]、[Google 搜索][G1]、[Apple 搜索][A1]
4. **相似度排序不是“找到/未找到”的证明。** Immich 所查两条文本智能搜索路径按向量距离排序并限制数量，未见相关性拒绝阈值；无真实匹配时仍可能返回近邻。Google 还明确提示新照片可能要等 3-5 天才能搜到。MaMage 应分别表达“无严格匹配”“仅有相似候选”“索引未完成”，不能默默放宽条件。[智能搜索源码][I5]、[Google 排障][G4]
5. **优先借鉴“明确数据范围 + 后台处理 + 可核验结果”，不要照搬个人图库假设。** Immich 代码在检索中施加账号/共享相册/锁定范围；Google 人脸标签是账号私有；Apple 披露本地分析和按照片授权。校园的部门权限、未成年人照片和人脸身份映射仍需单独设计，厂商隐私承诺不能替代 MaMage 的权限验证。[范围校验][I6]、[锁定策略][I8]、[Google 人脸][G5]、[Apple 隐私][A3]

## 二、逐项核验

### Google Photos / Ask Photos

| 项目 | 明确证据与边界 |
| --- | --- |
| 人物 + 动作/衣着 | 普通搜索帮助举例 `Alice and me laughing`，支持已标注姓名/昵称；`me` 需标记本人。人脸帮助提到可结合相近拍摄时间、同一衣着辅助归组，即使部分照片不见脸；**这是归组机制，不是“按指定人物衣着精确搜索”的证明**。[G1][G1]、[G5][G5] |
| 描述性搜索 | 普通搜索支持场景描述；引号用于文件名、相机型号、说明或照片内文字的精确文本匹配。Ask Photos 是另一个需主动启用的实验功能，支持描述式找图、图库问答和追问；当前帮助允许切换普通/Ask 结果。2025-06-26 官方更新明确先给普通搜索结果，Gemini 再后台处理复杂问题，但没有公开延迟指标。[G1][G1]、[G2][G2]、[G6][G6] |
| 否定 | 所查帮助未规定自然语言“不要某动作/衣着”或通用 `NOT` 的语义。普通搜索有排除“共享给我”内容的界面选项；屏蔽人脸的帮助说明针对回忆，不能推成通用搜索排除。[G1][G1]、[G5][G5] |
| 零结果 | 官方找图排障要求检查备份、日期、改关键词，并建议 3-5 天后重试；这是可搜索性延迟提示，不是 SLA。Ask 明示可能不准确；未公开零匹配阈值、自动放宽规则或“不存在”的证明机制。[G4][G4]、[G2][G2] |
| 权限/启用条件 | Ask 须 opt-in；Gemini Photos 当前要求年满 18 岁、已上线地区、开启 Face Groups、确认本人和位置估算。普通搜索可能包含共享相册/对话中尚未保存的内容；人脸标签默认账号私有，不随照片共享。不能据此推出学校域账号均可用或具备部门级 ACL。[G2][G2]、[G3][G3]、[G1][G1]、[G5][G5] |
| 数据预处理 | 官方明确备份与可搜索性可能存在时间差；隐私页披露系统会使用人脸标签、推断信息，反馈材料有时含 AI 图片描述。2024 官方架构文章描述“理解问题/制定检索计划 → 检索 → Gemini 查看结果/必要时读图中文字 → 作答”；**没有公开全部描述何时生成、向量库/索引结构或当前每次请求的完整执行计划**。[G4][G4]、[G3][G3]、[G7][G7] |

隐私措辞须保留限定：当前说明是“不用 Photos 个人数据训练 **Google Photos 之外** 的生成式模型”，不是“绝不训练任何模型”；查询可能经去标识处理后供人工审查，可关闭；反馈及少数滥用/伤害处置存在例外。[Gemini Photos 隐私中心][G3]

### Apple Photos 自然语言搜索

| 项目 | 明确证据与边界 |
| --- | --- |
| 人物 + 动作/衣着 | 当前 iPhone 搜索帮助明确举例 `Maya skateboarding in a tie-dye shirt`，并另列已命名人物。这是明确的组合查询示例，**不是多人关系绑定、细粒度服装辨识或中文校园数据准确率保证**。[A1][A1] |
| 描述性搜索 | 启用 Apple Intelligence 后可用自然语言描述找图；普通搜索还列出日期、地点、事件、人物、图片文字和说明，并支持筛选/排序。不能把它写成已经具备 Ask Photos 式跨照片自由问答。当前可用性页列出 Photos 自然语言搜索支持的平台，并保留设备/语言/地区限制。[A1][A1]、[A2][A2] |
| 否定 | 所查搜索帮助未公开通用自然语言否定或布尔语法。筛选收藏/已编辑等已有选项，不足以证明任意“有 A 无 B”的视觉语义约束。[A1][A1] |
| 零结果 | 官方缺图排障明确检查隐藏/最近删除、个人与共享图库视图、账号和同步。所查资料没有公开自然语言搜索的相关性阈值、零结果降级策略或召回率承诺。[A4][A4]、[A1][A1] |
| 权限/隐私 | 官方说明人脸、场景和物体检测在设备端进行，第三方 App 访问照片须授权且可只选部分照片；隐藏/最近删除相册默认锁定。不要将“本地分析”扩写为 Photos 每项功能绝无网络处理。当前 Apple Intelligence 文档仍列中国大陆设备/账号/所在地的可用性限制，不能假设中国校园用户均可使用。[A3][A3]、[A2][A2] |
| 数据预处理 | 2025-03-18 的 People & Pets 排障页明确先索引图库、再检测，手机需锁定并接电，可能耗时数天；**它证明该识别功能需要后台处理，不能把这组耗时/触发条件套到所有自然语言搜索索引**。自然语言搜索的完整索引、模型、更新时机仍未公开。[A5][A5]、[A1][A1] |

防止混用技术证据：2025-02-13 的 **Enhanced Visual Search 是地标搜索**，公开了设备端生成局部 embedding、加密后发服务器匹配全球地标表，以及同态加密等保护。不能用这份说明证明“人物+动作+衣着”采用相同架构。[Enhanced Visual Search][A6]

### Immich Smart Search

版本边界：联网核验的最新正式发布为 **v3.3.1（2026-10-08）**，源码固定到对应提交 `db6e11ecc851228aec9c525abb0ee026d1f5055e`，不把 `main` 当作已发布能力。官方在线文档会更新，应与固定源码区别阅读。[发布记录][I2]

| 项目 | 明确证据与边界 |
| --- | --- |
| 人物 + 动作/衣着 | 官方文档提供一人/多人脸过滤和上下文搜索；源码支持结构化人物过滤与文本查询并用。它证实“筛出含某人照片 + 以动作/衣着描述排序”的路径，**不证实动作或衣着一定属于该人**；所查路径未见人脸到人体服装/动作的专门绑定验证。[I1][I1]、[I3][I3]、[I4][I4]、[I6][I6] |
| 描述性搜索 | 文档明确使用 Postgres + VectorChord 做上下文 CLIP 搜索，不要求元数据有指定关键词。查询调用 `encodeText`，搜索已存 embedding；所查 Smart Search 路径不是 LLM 生成 SQL/对话式推理。英文/多语言模型可选，中文需要合适模型；文档通用数据集指标不等于校园图库效果。[I1][I1]、[I6][I6] |
| 否定 | 发布版接口明确有 ID 集合 `any/all/none`、字符串 `ne/notIn/notLike` 等；数据库实现把 `none` 转为不存在匹配关系，并执行 `notLike`。这是 **API/源码层支持**，不代表所有客户端都有相同控件。文本查询仍直接编码，不能据此保证视觉语义否定。[I3][I3]、[I4][I4]、[I6][I6] |
| 零结果 | `searchSmart` 与 `searchSmartV3` 均 join `smart_search` 后按 embedding 距离排序并取有限条数，方法内未见语义相关性阈值。因此“无真正匹配却仍给近邻”是源码推论；权限/结构化过滤后无候选或尚无向量也可为空。不能把人脸匹配中的 `maxDistance` 当作文本搜索拒绝阈值。[I5][I5] |
| 权限 | 服务端构造本人及满足共享条件的 partner 范围；新结构化路径校验相册读取权限，公开共享链接必须限制于相册。未提升权限的会话排除/拒绝锁定内容，锁定资产还限制所有者。说明范围约束在检索链路中可见，**不构成本次安全审计，也不是校园部门权限现成方案**。[I6][I6]、[I8][I8]、[I4][I4] |
| 数据预索引 | 后台 Smart Search 作业对图片文件调用 `encodeImage` 并存储向量，查询时编码文本。文档明确换模型后需重新处理全部资产；检索 inner join 向量表意味着未生成向量的资产不会进入该路径。这是源码支持的离线图片编码/在线查询编码，而非每次问句重新读全库。[I7][I7]、[I1][I1]、[I5][I5] |

## 三、没有公开或没有被证明的部分

- **Google/Apple**：所查资料未披露生产自然语言检索的完整模型版本、embedding 维度/索引结构、硬过滤与软排序融合权重、候选数、重排预算、否定解析规则、拒绝阈值和更新 SLA。Google 公布了概念流程，Apple 公布了部分本地分析/地标机制，不能写成“毫无实现信息”，也不能据此补全未披露部分。[G7][G7]、[G3][G3]、[A3][A3]、[A6][A6]
- **Immich**：模型选择、图片/文本编码、数据库检索、结构化排除和范围约束有源码，不应归为商业黑盒；但本次没有运行该版本，也没有证实部署实例的模型/索引完成度，或中文否定、多人属性绑定、校园照片的精确率/召回率。[I1][I1]、[I3][I3]、[I4][I4]、[I5][I5]、[I6][I6]、[I7][I7]
- **共同证据缺口**：本次一手资料没有提供“指定老师穿某色衣服做某动作，且无另一位老师”的校园合影基准；官方示例和展示只能作为待验证需求，不能作为已验证验收标准。[G1][G1]、[A1][A1]、[I1][I1]

## 四、对 MaMage 的建议（工程判断，不是厂商事实）

1. **保留硬约束，补软召回。** 人物 ID、日期、校区/活动和权限用可校验的结构化条件；LIKE 继续承担明确文本匹配，动作/场景/衣着可另加视觉语义候选。LLM 只产出白名单查询结构，权限由服务端强制执行。参考 Immich 的结构化过滤与编码检索分工。[I3][I3]、[I5][I5]、[I6][I6]
2. **不要把照片级描述当成人物级事实。** “王老师穿红衣讲话”需要绑定证据；“照片有王老师”与“照片有红衣发言者”相交仍可能错人。在没有人物区域/人工标注等证据前，呈现为待核验候选，不承诺精确命中。上述产品资料未填补这一证据缺口。[G1][G1]、[A1][A1]、[I4][I4]
3. **把否定变成显式条件，并保留未知。** “排除李老师”可依据已有的人脸关系过滤；“李老师未被识别”不能证明其不在照片。“不穿红衣”也不能用描述里没写“红衣”来证明。无法可靠执行的条件应告知，而不是静默丢弃。参考 Immich 数据关系排除的实际含义。[I3][I3]、[I4][I4]
4. **设计真实的空结果与索引状态。** 严格条件不满足时不自动变 OR；相似候选单列，且仍守权限与硬约束。区分无匹配、索引处理中、处理失败；借助经授权的离线校园样本校准是否拒绝低相关结果。依据 Google 延迟排障和 Immich 无相关性阈值的检索路径。[G4][G4]、[I5][I5]、[I7][I7]
5. **先做小规模离线验收，不承诺“对标即达标”。** 样本至少覆盖单人/多人、同色服装错人、遮脸、缺描述、中文动作近义词、排除人物、否定衣着、零结果和越权请求；分别评估人物约束命中率、属性绑定错误、召回率及错误放宽次数。仅使用授权样本，不从生产取图。本次报告不涉及实施。[G1][G1]、[A1][A1]、[I1][I1]、[I6][I6]

## 五、全部采用来源

以下均于 2026-10-13 联网读取。未标发布日期的帮助页仅标为当前在线版，不把抓取日冒充发布日期；2024 的 G7 仅用于厂商公开的概念架构，当前产品行为优先采用帮助页和 2025 更新。未采用媒体、论坛、用户评论或未合并 PR 作为依据。

| 编号 | 一手来源 | 日期/核验用途 |
| --- | --- | --- |
| G1 | [Search by people, things & places in your photos][G1] | 当前 Google 帮助；普通/Ask 区别、人物动作、精确文字、共享结果。 |
| G2 | [Use Ask Photos to search, edit & get assistance][G2] | 当前 Google 帮助；实验性、启用、追问、结果切换、备份要求。 |
| G3 | [Gemini features in Photos privacy hub][G3] | 当前 Google 帮助；资格、数据、推断/描述、训练与人工审查限定。 |
| G4 | [Find lost photos & videos][G4] | 当前 Google 帮助；备份、搜索排障、3-5 天可搜索性延迟。 |
| G5 | [Set up & manage your face groups][G5] | 当前 Google 帮助；人脸模型、时间/衣着辅助归组、私有标签、回忆屏蔽范围。 |
| G6 | [We’re improving Ask Photos and bringing it to more Google Photos users][G6] | 2025-06-26；先出结果与后台复杂查询处理的官方说明。 |
| G7 | [Ask Photos: A new way to search your photos with Gemini][G7] | 2024-05-14；“under the hood”概念流程，不用于确认现行完整实现。 |
| A1 | [Search for photos and videos on iPhone][A1] | 当前 Apple 帮助；人物/动作/衣着示例、筛选和共享图库搜索。 |
| A2 | [How to get the next generation of Apple Intelligence][A2] | 当前 Apple 帮助；支持平台、设备/语言/地区、中国大陆限制。 |
| A3 | [Privacy - Features（Photos 段落）][A3] | 当前 Apple 官方隐私说明；设备端分析、锁定相册、部分照片授权。 |
| A4 | [If you’re missing photos or videos in the Photos app][A4] | 2026-04-29；隐藏、同步、账号及个人/共享图库视图排障。 |
| A5 | [If you can’t find pets in the People & Pets album in Photos][A5] | 2025-03-18；该识别功能的预索引/后台检测条件，非全部自然语言搜索条件。 |
| A6 | [About Enhanced Visual Search in Photos][A6] | 2025-02-13；仅地标搜索的 embedding/服务器匹配和隐私技术。 |
| I1 | [Searching][I1] | 当前 Immich 文档；Postgres/VectorChord、过滤器、模型语言及换模型重处理。 |
| I2 | [Immich v3.3.1 Release][I2] | 2026-10-08；正式发布版本边界。 |
| I3 | [search.dto.ts][I3] | v3.3.1 固定提交；`IdsFilterSchema`、`StringPatternFilterSchema`、`SmartSearchSchema`。 |
| I4 | [utils/database.ts][I4] | 同上；`idsPredicates`、`personIdsPredicates`、`searchAssetBuilder`。 |
| I5 | [search.repository.ts][I5] | 同上；`searchSmart`、`searchSmartV3`，向量排序与候选数量。 |
| I6 | [search.service.ts][I6] | 同上；`resolveEmbedding`、`resolveSearchScopeV3`、`getUserIdsToSearch`。 |
| I7 | [smart-info.service.ts][I7] | 同上；Smart Search 作业、`encodeImage` 与向量持久化。 |
| I8 | [utils/search-filter.ts][I8] | 同上；`applyLockedVisibilityPolicy`。 |

[G1]: https://support.google.com/photos/answer/15235862?co=GENIE.Platform%3DDesktop&hl=en
[G2]: https://support.google.com/photos/answer/15318661?hl=en
[G3]: https://support.google.com/photos/answer/15344015?hl=en
[G4]: https://support.google.com/photos/answer/6306652?hl=en
[G5]: https://support.google.com/photos/answer/6128838?hl=en
[G6]: https://blog.google/products-and-platforms/products/photos/updates-ask-photos-search/
[G7]: https://blog.google/products-and-platforms/products/photos/ask-photos-google-io-2024/
[A1]: https://support.apple.com/guide/iphone/search-for-photos-and-videos-iph392d77d5f/ios
[A2]: https://support.apple.com/en-us/121115
[A3]: https://www.apple.com/privacy/features/#photos
[A4]: https://support.apple.com/en-us/118558
[A5]: https://support.apple.com/en-us/105081
[A6]: https://support.apple.com/en-ie/122033
[I1]: https://docs.immich.app/features/searching/
[I2]: https://github.com/immich-app/immich/releases/tag/v3.3.1
[I3]: https://github.com/immich-app/immich/blob/db6e11ecc851228aec9c525abb0ee026d1f5055e/server/src/dtos/search.dto.ts#L143
[I4]: https://github.com/immich-app/immich/blob/db6e11ecc851228aec9c525abb0ee026d1f5055e/server/src/utils/database.ts#L563
[I5]: https://github.com/immich-app/immich/blob/db6e11ecc851228aec9c525abb0ee026d1f5055e/server/src/repositories/search.repository.ts#L569
[I6]: https://github.com/immich-app/immich/blob/db6e11ecc851228aec9c525abb0ee026d1f5055e/server/src/services/search.service.ts#L302
[I7]: https://github.com/immich-app/immich/blob/db6e11ecc851228aec9c525abb0ee026d1f5055e/server/src/services/smart-info.service.ts#L87
[I8]: https://github.com/immich-app/immich/blob/db6e11ecc851228aec9c525abb0ee026d1f5055e/server/src/utils/search-filter.ts#L45

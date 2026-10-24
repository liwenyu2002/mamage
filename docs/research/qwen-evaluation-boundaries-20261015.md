# Qwen 替换的评测边界

日期：2026-10-15。仅审阅公开一手资料、指定缓存与当前源码；未运行模型、复跑基准、读取凭据或部署。真实配对结果由主代理另行报告，本文不预设提升幅度。

## 模型规格不是效果证明

- Hub 的 `qwen` 是可升级但 ID 不变的别名。指定缓存称其当前指向 **Qwen3.6-35B-A3B**，支持图片输入，输入与输出共用 **262,144 token** 窗口。在线 Hub 页本次未能通过检索工具读取，因此这是缓存记载，不是服务端权重核验。[Hub 文档](https://hub.zgci.org/docs/models/qwen.md)、[指定缓存第 1、5 行](/Users/liwenyu/mamage/.local/hub-inference-20261015/qwen.md:1)
- 上游模型卡在 **Language Model** 项下标明 **35B 总参数、3B 激活参数**，并列出视觉编码器和 MoE 架构。激活量不是模型总量，也不能直接与另一个多模态模型的整包参数口径比较。[Qwen 官方模型卡](https://huggingface.co/Qwen/Qwen3.6-35B-A3B#model-overview)
- Ollama 公开的 `qwen3-vl:8b` 标签页显示模型元数据 **8.77B、Q4_K_M**，包大小 **6.1GB**；这些不是本机已安装版本或峰值内存的证明。配对报告应记录实际安装摘要，不能仅凭 `8b` 名称确定权重、量化或模板。[Ollama 标签页](https://ollama.com/library/qwen3-vl:8b)
- **不得从 3B 激活参数推算内存、显存或能否装入某台机器。** 上述资料不足以确定运行时权重驻留、视觉部分、缓存及工作区开销；本次未测这些量。也不能由总参数比例推导速度或准确率。上游通用榜单不是 MaMage 配对结果。

## 能影响与不变部分

以下是当前应用链路的边界，不是模型能力上限；默认值不代表已读取的生产配置。

| 环节 | 换模型可能影响 | 单纯替换不能改变的限制 |
| --- | --- | --- |
| 整图语义 | 描述、人数/场景标签、OCR 的观察质量 | 同一图片先旋转、最长边缩至 1280、JPEG 88；标签总数最多 10，描述最多 160 字符。提示要求 OCR 最多 200 字，解析最多保留 500 字符。模型不能恢复缩图已丢失的细节。[输入](/Users/liwenyu/mamage/apps/server/ai_function/ai_for_tags/photo_quality.js:26)、[提示](/Users/liwenyu/mamage/apps/server/ai_function/ai_for_tags/ai_for_tags.js:65)、[解析](/Users/liwenyu/mamage/apps/server/ai_function/ai_for_tags/ai_for_tags.js:438) |
| 选片评分 | 构图、主体、瞬间、美感四维及缺陷判断 | 技术锐度/曝光仍由代码计算，占 25%/15%；四维权重仍为 20%/20%/12%/8%。严重模糊、闭眼、主体遮挡属致命缺陷，封顶 45 且拒绝；无致命缺陷时 ≤40 拒绝、≥75 推荐。均是固定规则，不是准确率或模型置信度。[评分实现](/Users/liwenyu/mamage/apps/server/ai_function/ai_for_tags/photo_quality.js:138) |
| 人物视觉输入 | 已定位人物的衣色、头身归属、动作判断 | 优先缩略图，读取上限 8MiB；最多 4 张既有人脸，解码限 32Mi 像素，先缩至 960，小于 10 像素的脸跳过；场景最长边 512，单人局部限 320×400，多人每格 192×240。局部由脸框扩展，不是身体检测框。[取图](/Users/liwenyu/mamage/apps/server/lib/search_visual_worker.js:11)、[裁剪](/Users/liwenyu/mamage/apps/server/lib/person_visual_inference.js:34) |
| 人物判定 | 在相同证据下更少错绑、误认或无根据断言 | 不识别人名；颜色限 12 类，动作限四类，复杂条件每次最多 8 条、每条最多 64 字符。衣色需 `binding=clear`、`visibility=clear` 且恰好一种颜色；多色、遮挡或缺证据为 unknown，不能作为否定命中。场景/自由条件仍受语义开关控制。[提示/条件](/Users/liwenyu/mamage/apps/server/lib/person_visual_inference.js:14)、[三态判断](/Users/liwenyu/mamage/apps/server/lib/person_visual_evidence.js:51) |
| 检索覆盖 | 已进入候选集且已核验的结果质量 | 只支持明确命中的单个人物；权限、日期等先限定候选，默认最多 128、配置范围 20–1000，按已有质量分等截取；超额或 unknown 不构成全库覆盖。后台队列限 128，取图/推理共享 60 秒中止信号，推理另有默认 45 秒超时。[条件编译](/Users/liwenyu/mamage/apps/server/lib/person_visual_evidence.js:24)、[候选](/Users/liwenyu/mamage/apps/server/lib/photo_search.js:405)、[队列](/Users/liwenyu/mamage/apps/server/lib/search_visual_worker.js:29)、[推理超时](/Users/liwenyu/mamage/apps/server/lib/person_visual_inference.js:75) |

照片视觉替换不等于替换身份检测/向量、文本查询规划或检索架构：文本规划另用 `AI_SEARCH_MODEL`/`AI_TEXT_MODEL`；普通图片相似性另走 ResNet。原照片的持久化描述/评分也不会仅因切换配置自动重算。[文本规划](/Users/liwenyu/mamage/apps/server/lib/ai_photo_search.js:209)、[相似性](/Users/liwenyu/mamage/apps/server/lib/image_similarity.js:101)、[照片写入](/Users/liwenyu/mamage/apps/server/lib/ai_tags_worker.js:276)

## 现有适配器并非等条件

| 路径 | Ollama 分支 | Hub 分支 |
| --- | --- | --- |
| 整图评分 | 默认温度 0.1、输出 512 token；`format=json`，未显式关闭思考，正文空时读 thinking | 温度 0、关闭思考、输出 2048 token；本调用未传 schema，因而适配器不加 `response_format` |
| 人物核验 | 温度 0、关闭思考、输出 512 token、`num_ctx=4096`；传 schema | 温度 0、关闭思考、输出 1024 token；`json_object` 加 schema 提示及本地结构校验 |

来源：[整图本地请求](/Users/liwenyu/mamage/apps/server/ai_function/ai_for_tags/ai_for_tags.js:561)、[整图入口](/Users/liwenyu/mamage/apps/server/ai_function/ai_for_tags/ai_for_tags.js:603)、[人物请求](/Users/liwenyu/mamage/apps/server/lib/person_visual_inference.js:69)、[Hub 适配](/Users/liwenyu/mamage/apps/server/lib/hub_inference.js:123)。Hub 默认启用思考且 token 上限包含思考，显式关闭是协议条件，不是准确率结论。[Hub 缓存说明](/Users/liwenyu/mamage/.local/hub-inference-20261015/qwen.md:62)

因此，沿用这两套配置得到的是“应用配置整体替换”的比较。只有统一图片字节、提示与可对齐的生成预算/思考设置，才更接近模型能力比较；服务端预处理、量化等未知条件仍须披露。262K 窗口不会自动放大当前裁剪、候选或输出预算。

## 准确率主张的门槛与风险

1. **固定配对与真值。** 使用相同图片、脸框/身份关联、查询、授权范围和人工标注，保存输入摘要、原始输出、解析结果及失败原因。固定提示和后处理版本；若同时改了人数归一化或提示，另行归因。独立人工核验须覆盖背景真人、海报人像、红背景/道具、遮挡、多色衣、微小脸、动作与否定难例；后选失败例只证明该例修复，不能外推全库。
2. **按任务报告，不以分高代替更准。** 人数、标签、OCR 分别对照真值；选片对照人工编辑标准，报告三档混淆及误推荐/误拒绝，四维分上升本身无效。人物报告误命中、漏命中、unknown/弃判与核验覆盖率，不能删除 unknown 后仅报“成功样本准确率”。动作/场景表现须与仅衣色核验分开。
3. **端到端检索另验。** 现有评估器要求 `judgmentsComplete=true` 且语料每张均有 0–3 人工等级；响应有效、无库外 ID 才计相关性。P@10 固定除以 10，Recall@50、NDCG@10、无相关图时正确空结果及硬约束违规须共同检查。标注不全时应报告“未测”，不能把模型评分当真值；仅模型直调不能证明产品检索改善。[评估器](/Users/liwenyu/mamage/apps/server/lib/photo_search_evaluation.js:20)
4. **小样本、失败与延迟不可隐去。** 报告样本量、配对改善/退化明细、重复运行波动及不确定性；困难诊断样本仅支持该集合结论。JSON 合法不等于观察正确。照片缺失 quality 会用四维默认 5 继续算分，worker 失败还可能降级到旧分析；人物输出需完整 JSON、≤16000 字符，目标编号恰出现一次才采纳。超时、截断、降级分别计数，区分首次调用、重复调用、证据缓存与队列等待，不能用端到端耗时推断硬件吞吐。[评分缺省](/Users/liwenyu/mamage/apps/server/ai_function/ai_for_tags/photo_quality.js:139)、[降级](/Users/liwenyu/mamage/apps/server/lib/ai_tags_worker.js:226)、[人物解析](/Users/liwenyu/mamage/apps/server/lib/person_visual_inference.js:108)
5. **版本与产品风险单列。** 记录测试日期、实际服务模型修订/本地摘要，不能仅写 `qwen`。人物缓存键含配置修订，但不会自动发现别名背后升级；clear 证据可保留 90 天。Hub 返回的 model 在当前上层调用未保留，应由主评测另存可取得的版本信息。图片字节会发送到校园 Hub，数据留存/访问边界需另核实；这不是本地推理同义词。[缓存指纹](/Users/liwenyu/mamage/apps/server/lib/person_visual_evidence.js:76)、[缓存寿命](/Users/liwenyu/mamage/apps/server/lib/search_visual_index.js:26)、[发送/返回](/Users/liwenyu/mamage/apps/server/lib/hub_inference.js:123)

另有不随模型改变的口径差异：选片三档以 40/75 分界，而搜索质量筛选仍存在 `<55` 拒绝、`55–74` 中等的数值条件并与标签 OR 合并。换模型不能修复这项差异，应区分评分输出与筛选结果。[质量筛选](/Users/liwenyu/mamage/apps/server/lib/photo_search.js:319)

结论：更好的视觉观察、指令遵循与结构化输出是可检验的改善方向；身份正确性、评分校准、候选全覆盖、数据合规和稳定性能均不能由模型名称、参数规模或接口成功推出。当前只能提出这些验证标准，不能宣称 MaMage 准确率已经提升。

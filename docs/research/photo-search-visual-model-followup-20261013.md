# MaMage 图像检索模型补充核验

核验日期：2026-10-13。仅查阅官方公开模型卡、仓库和文档；未访问生产数据、运行模型或修改检索实现。以下方案均为待评测建议，不是已部署能力；MaMage 当前代码瓶颈由主任务另行核验。

## 结论

建议优先补齐“离线图片向量 + 在线文本向量召回 + 小候选集图文精排”，不把全库重新生成描述作为前置条件。Qwen 官方明确区分独立编码的 Embedding 与成对打分的 Reranker；Immich 的 CLIP 搜索也直接比较图片与查询向量，不依赖先生成标签或描述。[Qwen 官方架构](https://github.com/QwenLM/Qwen3-VL-Embedding#architecture-design)、[Immich FAQ](https://docs.immich.app/FAQ/#how-does-smart-search-work)

这支持新增视觉检索能力，但不能据此断言“现有识图模型必须整体替换”或“换大模型就能解决搜索”。建议先保留现有描述、OCR、人物与权限链路，测试向量召回的增量收益，再决定是否升级描述生成模型。

## 模型能力与边界

| 候选 | 官方已核实能力 | 建议用途与边界 |
|---|---|---|
| Qwen3-VL-Embedding-2B | 2B、32K 上下文；支持文本、图片、截图、视频及混合输入；输出维度 64–2048，可定制指令；官方仓库语言列表含中文。[模型卡](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B)、[语言与架构](https://github.com/QwenLM/Qwen3-VL-Embedding) | 离线编码照片，在线只编码查询；作为较大模型对照组。多语言支持不是本图库长句、否定或合影关系准确率的保证。 |
| Qwen3-VL-Reranker-2B | 2B、32K；输入查询与候选的配对，支持图文等混合模态，输出相关性分数，不是供全库索引的向量。[模型卡](https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B) | 对召回后的少量真实候选图片精排，不能只给旧描述却期待修复描述漏写的视觉事实；也不能找回完全未进入候选集的照片。 |
| Chinese-CLIP | 中文图文特征与相似度计算、跨模态检索、零样本分类；RN50 为 77M，ViT-B/16 为 188M。[官方仓库](https://github.com/OFA-Sys/Chinese-CLIP#模型规模--下载链接) | ViT-B/16 作为小参数量基线，资源更紧时再测 RN50。“轻量”仅指相对参数规模，不代表已证明目标 Mac 的速度、内存或兼容性。 |

注意：Qwen 表中的 `Quantization Support` 指输出 embedding 的量化后处理，不是模型权重低比特推理或 Mac 加速保证；缩短向量也不等于减少模型参数。公开模型基准不能换算成本图库收益。[Embedding 模型卡说明](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B#qwen3-vl-embedding-and-qwen3-vl-reranker-model-list)

## Immich 可借鉴什么

- **后台图片编码**：`handleEncodeClip` 调用 `encodeImage` 后写入索引；写入前检查模型是否已切换。[官方实现](https://github.com/immich-app/immich/blob/main/server/src/services/smart-info.service.ts)
- **在线文本编码与缓存**：`resolveEmbedding` 调用 `encodeText`，缓存键含模型、查询与语言；搜索调用同时携带可搜索用户范围。[官方实现](https://github.com/immich-app/immich/blob/main/server/src/services/search.service.ts)
- **语义搜索与结构化过滤分工**：文档列出人物、相册、时间、OCR 等筛选；底层为 Postgres + VectorChord，换模型需重新处理 Smart Search 索引。[搜索文档](https://docs.immich.app/features/searching/)
- **不是直接照搬部署**：这里只借鉴架构，不建议为此迁移 MaMage 数据库，也不声称 Immich 已使用上述 Qwen 精排。其 FAQ 说明仅支持列出的兼容模型，不能假设填入 Qwen 模型名即可接入。[兼容性说明](https://docs.immich.app/FAQ/#can-i-use-a-custom-clip-model)

## 最小验证顺序（建议，尚未执行）

1. 在获授权的本地样本建立固定中文查询与人工相关性标注，覆盖动作、衣着、多人合影、明确人物、否定和无结果；不上传照片、查询或人物资料到外部推理服务。
2. 保留现有检索作对照，分别测试 Chinese-CLIP ViT-B/16 与 Qwen3-VL-Embedding-2B。图片后台增量编码，查询在线编码；每个索引记录模型版本、维度与预处理版本，不混用两模型向量。
3. 在授权范围和明确人物/日期/相册约束内，合并关键词与向量候选。可先试召回 top-100，再由 Qwen Reranker 对 top-10 / top-20 图片精排；这些数量是实验起点，不是官方默认值或性能承诺。
4. 分别记录 Recall@100、前 10 条人工相关率、身份/属性误配、无结果误报，以及查询编码、召回、精排的 p50/p95、内存与离线吞吐。只在收益与资源均达标后切换；精排超时可退回原候选排序，不删除明确约束。
5. “某老师穿红衣”仍需可靠人物身份与脸到身体/区域的关联证据；整图向量或精排高分都不能证明红衣属于该老师。否定也不能仅凭相似度判真。此为业务设计边界，不声称上述模型保证主体绑定；证据不足应标注相关候选或未知。

仅在评测发现描述/OCR 的持续漏项确实影响目标任务时，再针对问题图片补识别或评估描述模型升级，不先重做全库 caption。

本次只新增本文；未安装、构建、部署、推送或改动其他工作区文件。

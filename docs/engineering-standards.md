# MaMage 工程纪律（对标 PhotoStory 后落地版）

> 缘起：2026-11-20 对照 `z.gitee.cn/zgca/PhotoStory`（FastAPI + TS），只借鉴**纪律**，不迁移技术栈。
> 每条都写成"我们现在怎么做 / 检查方式"，能自动化的都给了脚本。

## 一、从 PhotoStory 学到的 8 条

| # | 他们的做法 | 我们的落法 |
|---|---|---|
| 1 | `routers → services → dao → models`，请求/响应各一套 Pydantic schema | 服务端继续分层，但**先卡死入口守卫**：每个写接口必须显式鉴权（见 §2 矩阵） |
| 2 | 每个对外 API 有一份契约文档（参数表、错误码、鉴权、示例） | `docs/api-auth-matrix.md` 由脚本自动生成；新增接口必须重跑脚本 |
| 3 | 配置集中在 `config.py`（pydantic-settings，字段别名 = 环境变量名） | 服务端保留 `container_config.js` 校验必填项；新增环境变量必须同时更新校验与文档 |
| 4 | 模块头写"契约"（如 ephemeral：不落库、只读 vector、retention=none） | 涉及数据边界的模块（上传/共享/编辑/导出）必须写 3 行契约注释 |
| 5 | 测试按包镜像放置，回归用例以 bug 命名（`sse_parser_test`、`summary_all_cooldown_test`） | 单测文件名用 `test_<模块>_<缺陷>.js`，回归必须能指出它守的是哪个 bug |
| 6 | 前端 TS + 按域拆 `api/` 层，路由守卫独立组件（ProtectedRoute / PublicRoute） | 暂不迁 TS；但 api 调用必须走 `services/*`，组件内禁止裸 `fetch('/api/...')`（lint 逐步收紧） |
| 7 | 提交信息 `type(scope): 说明` | `.githooks/commit-msg` 强制校验；`git config core.hooksPath .githooks` 已开启 |
| 8 | 数据库演进走 alembic，40 个迁移可回溯 | 迁移文件按 `YYYYMMDD_NNN_*.sql` 命名，只增不改；禁止手改线上表结构 |

## 二、我们自己的 5 条硬规则

1. **禁止热修镜像**：所有上线镜像必须能由 `scripts/release-image.sh <api|web>` 从已提交 SHA 构建，tag = `release-<sha>`。工作树不干净时脚本直接拒绝。
2. **先 lint 再提交**：`scripts/ci.sh` 是唯一入口（lint → 单测 → 构建）。当前门槛是 **0 error**，warning 记入基线不阻塞，但每月要降。
3. **Hooks 不准条件调用**：React 组件里 `if (!x) return null` 必须放在外层守卫组件，不能出现在 hooks 之前（已在 `ProjectDetail` 修过一次，`react-hooks/rules-of-hooks` 设为 error）。
4. **接口必须显式鉴权**：`docs/api-auth-matrix.md` 里标"（路由内自行鉴权）"的接口，逐个确认实现里调用了 `requirePermission / requireProjectAccess / accessAdministrator`；新增接口同理。
5. **发布留痕**：每次上线在 `docs/release-YYYYMMDD.md` 写清 SHA、镜像 tag、验证命令与已知遗留。

## 三、当前基线（2026-11-20）

| 项 | 数值 | 命令 |
|---|---|---|
| web lint error | 0（warning 27） | `cd apps/web && node_modules/.bin/eslint src` |
| server lint error | 0（warning 23） | `cd apps/server && node_modules/.bin/eslint .` |
| `no-unused-vars` | web 785 → **0**，server 228 → **0** | 同上 |
| `react-hooks/exhaustive-deps` | web 69 → **0**（补依赖 12 处、ref 稳定 9 处、刻意豁免 21 处并写明原因） | 同上 |
| react-hooks 违规 | 103 → **0** | 同上 |
| 导航回归 | 19 / 19 | `cd apps/web && node scripts/test-navigation-browser.cjs` |
| 调色/编辑单测 | 34 项通过 | `cd apps/server && npm run test:photo-tone` |
| 接口总数 | 212 条（见矩阵） | `node scripts/gen-auth-matrix.mjs` |

## 四、本轮顺手修掉的真问题

- `App.jsx` 调用 `clearExplicitLogout()` 但 `services/logoutHold` 模块缺失：只要 URL 带 `dingtalk_token=` 就会 `ReferenceError` 白屏。已补齐模块与 import。
- `ProjectDetail` 在 hooks 之前 `return null`：`projectId` 由空变非空时会抛 "Rendered more hooks than during the previous render"。已改为外层守卫组件。

## 四之二、DAO 层与 TypeScript（2026-11-20 落地）

- `apps/server/lib/queries/photos.js`：照片鉴权用户、原图行、批量删除、相册 photo_ids 回写、下载名映射等 7 处
  （`routes/photos.js` 24 → 17）。
- `apps/server/lib/queries/projects.js`：时间线环节 11 处（列表/加锁/更新/插入/删除/同名检测/排序号/回读），
  `routes/projects.js` 48 → 35。
- `apps/server/lib/queries/video_projects.js`：视频工程 CRUD 与渲染任务 15 处（`routes/video_projects.js` 33 → 18）。
- `apps/server/lib/queries/users.js`：重复校验、改密、邀请码 11 处（`routes/users.js` 28 → 17）。
- `apps/server/lib/queries/workspaces.js`：单位列表/活跃单位/成员角色/移除成员/人脸授权/审计 13 处
  （`routes/workspaces.js` 22 → 7）。
- `apps/server/lib/queries/upload.js`：相册 photo_ids 追加、摄影师名、视频语义分析开关 8 处
  （`routes/upload.js` 25 → 15）。
- `apps/server/lib/queries/share_links.js`：建链/撤销/可管理校验/待审照片/批准写条目 6 处
  （`routes/share.js` 16 → 10）。
- `apps/server/lib/queries/internal_shares.js`：幂等查重、建分享/条目/复制任务/审计、撤销 7 处
  （`routes/internal_shares.js` 24 → 16）。
- `apps/server/lib/queries/faces.js`：人脸审计、人物编号、拆分的锁脸/建人/搬脸/封面、归属变更 9 处，
  `routes/faces.js` 42 → 25（含人物合并的锁人/搬脸/改名/删人）。约定：dao 返回 `affectedRows` 数字而非原始元组，
  避免调用方解构口径不一。
- 规则：**新的查询写进 `lib/queries/<域>.js`**，routes 只做编排与错误码；SQL 不再散落在路由里。
- 棘轮：`scripts/audit-inline-sql.mjs` 统计 `routes/` 内联 SQL 调用点，当前 **261**，
  `ci.sh` 用 `--fail-over 261` 卡住"只降不升"，每迁一个文件把阈值下调（374 → … → 278 → 269 → 261）。
- TypeScript：`tsconfig.json` + `@babel/preset-typescript` 已接入 webpack（`.ts/.tsx` 与 JS 同管线），
  `npm run typecheck` 进 CI；首个 TS 模块 `services/shareService.ts`。

## 五、还没做（按优先级）

1. ~~`no-unused-vars` 清理~~ ✅ 已完成（web 死代码 20 处、未使用导入 464 个说明符；server 7 处）
2. `react-hooks/exhaustive-deps` 69 条 → 逐条确认是真缺依赖还是故意
3. 组件内裸 `fetch` 收敛到 `services/`
4. 服务端 route 内联 SQL 抽到 `lib/`（对齐 dao 层）
5. 前端迁移 TS（收益大但成本最高，建议新模块先行）

> 2026-11-20 追加：组件内裸 `fetch('/api/...')` 已清零（20 处 → 0），全部经 `services/`。
> 新增服务：`shareService`（公开分享读/建）、`accountService`（用户/角色/邀请码/改密）；
> `authService` 扩了 providers/login/email-code/register/IAM 二维码取消；`projectService` 扩取景项目；`newsMatrixService` 扩服务端渲染预览。
